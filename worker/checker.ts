import { supabaseService } from '../lib/supabase';
//import { crawlAndCapture } from '../lib/playwright';
import { crawlAndCapture } from '../lib/fetcher';
import { shallowDiff } from '../lib/diff';
import { sendEmailAlert, sendSlackAlert } from '../lib/alerts';

(async function run() {
  const { data: monitors, error } = await supabaseService.from('monitors').select('*').eq('is_active', true);
  if (error) {
    console.error(error);
    process.exit(1);
  }

  for (const m of monitors || []) {
    try {
      const snap = await crawlAndCapture(m.url, m.region || 'us', m.css_hint || undefined);
      const { data: prevSnaps } = await supabaseService
        .from('snapshots')
        .select('*')
        .eq('monitor_id', m.id)
        .order('created_at', { ascending: false })
        .limit(1);
      const prev = prevSnaps && prevSnaps[0];

      const { data: newSnap, error: insertErr } = await supabaseService
        .from('snapshots')
        .insert({ monitor_id: m.id, html: snap.html, text_content: snap.text, screenshot_path: snap.screenshot_path, price_json: snap.price, hash: snap.hash })
        .select('*')
        .single();
      if (insertErr) throw insertErr;

      await supabaseService.from('monitors').update({ last_checked_at: new Date().toISOString() }).eq('id', m.id);

      let changed = true;
      if (prev && prev.hash === snap.hash) changed = false;

      if (changed && prev) {
        const diff = shallowDiff(prev.price_json || {}, snap.price);
        const summary = `Pricing change detected for ${m.name || m.url}`;
        await supabaseService.from('changes').insert({ monitor_id: m.id, prev_snapshot_id: prev.id, new_snapshot_id: newSnap.id, summary, diff });

        const emailHtml = `
          <h2>${summary}</h2>
          <p><a href="${m.url}">${m.url}</a></p>
          <p><strong>Before:</strong> ${JSON.stringify(prev.price_json)}</p>
          <p><strong>After:</strong> ${JSON.stringify(snap.price)}</p>
          <p>Screenshot: ${snap.screenshot_url}</p>
        `;
        await sendEmailAlert(summary, emailHtml);
        await sendSlackAlert(`${summary} -> ${snap.screenshot_url}`, m.slack_webhook || undefined);
      }

      console.log('checked', m.url, 'changed:', changed);
    } catch (e: any) {
      console.error('error for', m.url, e.message);
    }
  }

  process.exit(0);
})();

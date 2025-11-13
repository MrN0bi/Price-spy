import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runPricingPipeline, type PipelineResult } from '@/lib/pipeline';
import { saveSnapshotFull, type ROI } from '@/lib/supabase';
import { sendEmailAlert, sendSlackAlert } from '@/lib/alerts';

type PostBody = {
  url?: string;
  monitorId?: string;
  sendAlerts?: boolean;
  preferredContainer?: string; // unused now, kept for compatibility
  nodeIndex?: number; // optional override when calling directly with URL
};

type MonitorRow = {
  id: string;
  url: string;
  name: string | null;
  css_hint: string | null;
  region: string | null;
  email: string | null;
  slack_webhook: string | null;
  node_index: number | null;
};

function getServiceSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get('content-type') || '';
    let body: PostBody;
    if (ct.includes('application/json')) {
      body = await req.json();
    } else {
      const form = await req.formData();
      body = {
        monitorId: (form.get('monitorId') as string) || undefined,
        url: (form.get('url') as string) || undefined,
      };
    }

    const supabase = getServiceSupabase();
    let monitor: MonitorRow | null = null;
    if (body.monitorId) {
      const { data, error } = await supabase
        .from('monitors')
        .select('*')
        .eq('id', body.monitorId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      monitor = (data as any) || null;
    }

    const url = monitor?.url || body.url;
    if (!url) {
      return NextResponse.json(
        { ok: false, error: 'Missing URL/monitorId' },
        { status: 400 }
      );
    }

    const cssHint = monitor?.css_hint || undefined;
    const nodeIndex =
      monitor?.node_index ?? body.nodeIndex ?? undefined;

    const result: PipelineResult = await runPricingPipeline({
      url,
      cssHint,
      nodeIndex,
    });

    const saved = await saveSnapshotFull({
      url,
      monitorId: monitor?.id,
      html: result.html,
      priceJson: result.currentPricing,
      layout: [],
      screenshotPathLocal: result.screenshot_path || undefined,
      rois: result.rois as ROI[],
      visualHashHex: result.visual_hash || undefined,
      htmlHashHex: result.html_hash,
      uploadScreenshot: true,
    });

    const changed = !!result.changed;
    if (changed && (monitor?.email || process.env.ALERTS_TO_EMAIL)) {
      await sendEmailAlert(
        `Pricing changed: ${monitor?.name || url}`,
        `<pre>${JSON.stringify(result.diff || {}, null, 2)}</pre>`
      );
    }
    if (changed && monitor?.slack_webhook) {
      await sendSlackAlert(
        `Pricing changed: ${monitor?.name || url}`,
        monitor.slack_webhook
      );
    }

    return NextResponse.json({
      ok: true,
      url,
      cssHint,
      html_hash: result.html_hash,
      text_hash: result.text_hash,
      pricing_hash: result.pricing_hash,
      visual_hash: result.visual_hash,
      screenshot_sha256: result.screenshot_sha256,
      screenshot_path: result.screenshot_path,
      rois: result.rois,
      saved,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Unhandled error' },
      { status: 500 }
    );
  }
}

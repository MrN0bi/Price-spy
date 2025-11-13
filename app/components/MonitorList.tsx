import { supabaseService } from '@/lib/supabase';
import { Monitor } from '@/lib/types';

async function getData() {
  const { data, error } = await supabaseService
    .from('monitors')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error.message);
    return [] as Monitor[];
  }
  return (data || []) as Monitor[];
}

function formatUtcReadable(iso?: string | null) {
  if (!iso) return '—';
  const dt = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return fmt.format(dt) + ' UTC';
}

export default async function MonitorList() {
  const monitors = await getData();
  if (!monitors.length) {
    return <div className="text-sm text-gray-500">No monitors yet.</div>;
  }
  return (
    <div className="space-y-3">
      {monitors.map((m) => (
        <div key={m.id} className="p-3 border rounded-lg">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div className="space-y-1">
              <div className="font-medium">{m.name || m.url}</div>
              <div className="text-xs text-gray-500 break-all">{m.url}</div>
              <div className="text-xs">
                <span className="text-gray-500">CSS hint:</span> <code className="bg-gray-100 px-1 py-0.5 rounded">{m.css_hint || '—'}</code>
              </div>
            </div>
            <form method="post" action="/api/run-check">
              <input type="hidden" name="monitorId" value={m.id} />
              <button className="px-3 py-1.5 rounded-xl bg-gray-900 text-white">Run Check</button>
            </form>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Last checked: <time dateTime={m.last_checked_at || undefined} suppressHydrationWarning>{formatUtcReadable(m.last_checked_at)}</time>
          </div>
        </div>
      ))}
    </div>
  );
}

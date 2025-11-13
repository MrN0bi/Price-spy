-- Schema for Supabase (run in SQL editor)
-- Storage: create bucket 'screenshots' manually or via SQL
--   select storage.create_bucket('screenshots', public := true);

create table if not exists monitors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  url text not null,
  name text,
  region text default 'us',
  css_hint text, -- optional CSS selector to narrow pricing area
  email text,    -- who to alert
  slack_webhook text, -- optional per-monitor override
  last_checked_at timestamp with time zone,
  is_active boolean default true
);

create table if not exists snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  monitor_id uuid references monitors(id) on delete cascade,
  html text,
  text_content text,
  screenshot_path text,
  price_json jsonb, -- normalized fields extracted
  hash text
);

create table if not exists changes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  monitor_id uuid references monitors(id) on delete cascade,
  prev_snapshot_id uuid references snapshots(id),
  new_snapshot_id uuid references snapshots(id),
  summary text,
  diff jsonb
);

-- helpful index
create index if not exists idx_snapshots_monitor on snapshots(monitor_id);
create index if not exists idx_changes_monitor on changes(monitor_id);
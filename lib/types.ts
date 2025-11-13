export type Monitor = {
  id: string;
  created_at: string;
  url: string;
  name: string | null;
  region: string | null;
  css_hint: string | null;
  node_index: number | null; // NEW: which match of css_hint to use (1-based)
  email: string | null;
  slack_webhook: string | null;
  last_checked_at: string | null;
  is_active: boolean;
};

export type Snapshot = {
  id: string;
  created_at: string;
  monitor_id: string;
  url: string | null;
  html: string | null;
  text_content: string | null;
  html_hash: string | null;
  text_hash: string | null;
  pricing_hash: string | null;
  visual_hash: string | null;
  screenshot_sha256: string | null;
  screenshot_path: string | null;
  price_json: any | null;
  hash: string | null;
};

export type Change = {
  id: string;
  created_at: string;
  monitor_id: string;
  prev_snapshot_id: string | null;
  new_snapshot_id: string;
  summary: string | null;
  diff: any | null;
};

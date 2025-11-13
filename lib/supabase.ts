// lib/supabase.ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export type ROI = { bbox: { x: number; y: number; width: number; height: number } };
export type LayoutEntry = { path: string; bbox: { x: number; y: number; width: number; height: number } };

// ---------- ENV ----------
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'screenshots';

export const SUPABASE_TABLE = process.env.SNAPSHOTS_TABLE || 'snapshots';

// ---------- CLIENTS ----------
function makeClient(service = true) {
  const key = service ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !key) {
    throw new Error(
      'Supabase env vars missing. NEXT_PUBLIC_SUPABASE_URL and (server) SUPABASE_SERVICE_ROLE_KEY are required.'
    );
  }
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const supabaseService = makeClient();
function getClient() {
  return supabaseService;
}

// ---------- UTILS ----------
export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function htmlToText(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function hashCanonicalJson(obj: any): string {
  const j = JSON.stringify(obj ?? null, Object.keys(obj ?? {}).sort());
  return sha256(j);
}

/**
 * saveSnapshotFull
 * - Optionally uploads screenshot to Storage and saves key in `screenshot_path`
 * - Computes:
 *   - html_hash (raw HTML)
 *   - text_content + text_hash (visible text)
 *   - pricing_hash (canonical JSON of price_json)
 *   - visual_hash (not computed now; null) and screenshot_sha256 (PNG bytes)
 * - Persists `rois`
 */
export async function saveSnapshotFull(params: {
  url?: string;
  monitorId?: string;
  html: string;
  priceJson: any;
  layout: LayoutEntry[];
  screenshotPathLocal?: string;
  rois?: ROI[];
  visualHashHex?: string; // optional precomputed perceptual hash (unused for now)
  htmlHashHex?: string;   // optional precomputed raw HTML hash
  uploadScreenshot?: boolean; // default true
}): Promise<{
  html_hash: string;
  text_hash: string;
  pricing_hash: string;
  visual_hash: string | null;
  screenshot_sha256: string | null;
  screenshot_path: string | null;
}> {
  const supabase = getClient();

  const html_hash = params.htmlHashHex || sha256(params.html);
  const text_content = htmlToText(params.html);
  const text_hash = sha256(text_content);
  const pricing_hash = hashCanonicalJson(params.priceJson);
  const visual_hash = null;

  // Upload screenshot if available
  let screenshot_sha256: string | null = null;
  let screenshot_path: string | null = null;
  if (params.screenshotPathLocal && (params.uploadScreenshot ?? true)) {
    try {
      const buf = fs.readFileSync(params.screenshotPathLocal);
      screenshot_sha256 = sha256(buf);
      const fileName = path.basename(params.screenshotPathLocal);
      const key = `${(params.monitorId || 'misc')}/${fileName}`;
      const { data: up, error: upErr } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(key, buf, {
          contentType: 'image/png',
          upsert: true,
        });
      if (upErr) throw upErr;
      screenshot_path = up?.path || key;
    } catch {
      // ignore upload failure
    }
  }

  // Persist snapshot row (best-effort; schema is assumed)
  try {
    const row = {
      monitor_id: params.monitorId || null,
      url: params.url || null,
      created_at: new Date().toISOString(),
      html: params.html,
      text_content,
      price_json: params.priceJson,
      html_hash,
      text_hash,
      pricing_hash,
      visual_hash,
      screenshot_sha256,
      screenshot_path,
      rois: params.rois || [],
    };
    const { error } = await supabase.from(SUPABASE_TABLE).insert(row as any);
    if (error) {
      // Do not throw — still return computed hashes
      // console.error('[saveSnapshotFull] insert error:', error.message);
    }
  } catch {
    // ignore
  }

  return {
    html_hash,
    text_hash,
    pricing_hash,
    visual_hash,
    screenshot_sha256,
    screenshot_path,
  };
}

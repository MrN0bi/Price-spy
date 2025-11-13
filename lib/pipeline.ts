import crypto from 'crypto';
import * as cheerio from 'cheerio';
import {
  extractPricingFromHtml,
  type NormalizedPricing,
} from './grid_pricing_extractor';
import { capturePage } from './playwright';

export interface PipelineInputObj {
  url: string;
  cssHint?: string;
  nodeIndex?: number; // 1-based index among matches of cssHint
  preferredContainer?: string; // unused now
}

export type PipelineInput = string | PipelineInputObj;

export type ROI = {
  bbox: { x: number; y: number; width: number; height: number };
};

export interface PipelineResult {
  url: string;
  html: string; // scoped HTML when cssHint/nodeIndex are provided
  currentPricing: NormalizedPricing;
  prevPricing?: NormalizedPricing | null;
  diff?: any;
  changed?: boolean;
  html_hash: string;
  text_hash: string;
  pricing_hash: string;
  visual_hash: string | null;
  screenshot_sha256: string | null;
  screenshot_path: string | null;
  rois: ROI[];
}

function htmlToText(html: string): string {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function sha256(input: string | Buffer) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function canonicalJsonHash(obj: any) {
  const json = JSON.stringify(obj ?? null, Object.keys(obj ?? {}).sort());
  return sha256(json);
}

// Overloads for compatibility
export async function runPricingPipeline(
  url: string,
  opts?: { cssHint?: string; nodeIndex?: number }
): Promise<PipelineResult>;
export async function runPricingPipeline(
  input: PipelineInputObj
): Promise<PipelineResult>;
export async function runPricingPipeline(
  arg1: any,
  arg2?: any
): Promise<PipelineResult> {
  const url: string = typeof arg1 === 'string' ? arg1 : arg1.url;
  const cssHint: string | undefined =
    typeof arg1 === 'string' ? arg2?.cssHint : arg1.cssHint;
  const nodeIndex: number | undefined =
    typeof arg1 === 'string' ? arg2?.nodeIndex : arg1.nodeIndex;

  const snap = await capturePage(url, {
    outDir: process.env.SCREENSHOT_DIR || '/tmp/pricing-monitor',
  });

  const fullHtml = snap.html;

  // Use cssHint + nodeIndex for pricing extraction
  const currentPricing = extractPricingFromHtml(
    fullHtml,
    cssHint,
    nodeIndex
  );

  // Scoped HTML for storage: prefer a single node when nodeIndex is set
  let scopedHtml = fullHtml;
  if (cssHint && cssHint.trim()) {
    try {
      const $ = cheerio.load(fullHtml);
      const matches = $(cssHint as any);
      if (matches && matches.length > 0) {
        if (nodeIndex && nodeIndex > 0) {
          const idx = Math.min(
            Math.max(nodeIndex - 1, 0),
            matches.length - 1
          );
          const selection = matches.eq(idx);
          scopedHtml = selection
            .toArray()
            .map((el) => $.html(el))
            .join('\n');
        } else {
          scopedHtml = matches
            .toArray()
            .map((el) => $.html(el))
            .join('\n');
        }
      }
    } catch {
      scopedHtml = fullHtml;
    }
  }

  const text = htmlToText(scopedHtml);
  const html_hash = sha256(scopedHtml);
  const text_hash = sha256(text);
  const pricing_hash = canonicalJsonHash(currentPricing);

  const screenshot_path = snap.screenshotPath || null;
  const screenshot_bytes_hash = snap.screenshotPath
    ? await import('fs').then((fs) => {
        try {
          const buf = fs.readFileSync(snap.screenshotPath);
          return sha256(buf);
        } catch {
          return null;
        }
      })
    : null;

  return {
    url,
    html: scopedHtml,
    currentPricing,
    prevPricing: null,
    diff: null,
    changed: false,
    html_hash,
    text_hash,
    pricing_hash,
    visual_hash: null,
    screenshot_sha256: screenshot_bytes_hash,
    screenshot_path,
    rois: [],
  };
}

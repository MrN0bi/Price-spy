// lib/roi_extract.ts
import type { NormalizedPricing } from './grid_pricing_extractor';

export type LayoutEntry = { path: string; bbox: { x: number; y: number; width: number; height: number } };

function overlaps(a: LayoutEntry['bbox'], b: LayoutEntry['bbox']) {
  const ax = Math.max(a.x, b.x), ay = Math.max(a.y, b.y);
  const bx = Math.min(a.x + a.width, b.x + b.width), by = Math.min(a.y + a.height, b.y + b.height);
  return ax < bx && ay < by;
}

/**
 * Placeholder for any ROI-based flows (disabled now).
 * We keep the signature for later re-enablement.
 */
export function extractFromRois(html: string, _layout: LayoutEntry[], _rois: LayoutEntry['bbox'][]): NormalizedPricing {
  return { unit: 'unknown', tiers: [] };
}

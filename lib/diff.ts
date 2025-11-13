// lib/diff.ts
// Keep this file focused on comparing two NormalizedPricing objects.

export type Period = 'monthly' | 'yearly' | 'unknown';
export type Currency = '$' | '€' | '£' | '¥' | 'kr' | 'unknown';

export interface Tier {
  name?: string;
  amount?: number;
  currency?: Currency;
  period?: Period;
  raw?: string;
  features?: string[];
}

export interface NormalizedPricing {
  unit: 'per seat' | 'per month' | 'unknown';
  tiers: Tier[];
}

export function shallowDiff(a: NormalizedPricing, b: NormalizedPricing) {
  const diffs: any = { unit: null as any, tiers: [] as any[] };

  if (a.unit !== b.unit) diffs.unit = { from: b.unit, to: a.unit };

  const maxLen = Math.max(a.tiers.length, b.tiers.length);
  for (let i = 0; i < maxLen; i++) {
    const at = a.tiers[i];
    const bt = b.tiers[i];
    if (!at && bt) {
      diffs.tiers.push({ index: i, change: 'removed', from: bt });
    } else if (at && !bt) {
      diffs.tiers.push({ index: i, change: 'added', to: at });
    } else if (at && bt) {
      const tChanges: any = {};
      if (at.name !== bt.name) tChanges.name = { from: bt.name, to: at.name };
      if (at.currency !== bt.currency) tChanges.currency = { from: bt.currency, to: at.currency };
      if (at.period !== bt.period) tChanges.period = { from: bt.period, to: at.period };
      const aAmt = typeof at.amount === 'number' ? at.amount : null;
      const bAmt = typeof bt.amount === 'number' ? bt.amount : null;
      if (aAmt !== bAmt) tChanges.amount = { from: bAmt, to: aAmt };

      if (Object.keys(tChanges).length > 0) {
        diffs.tiers.push({ index: i, change: 'modified', ...tChanges });
      }
    }
  }

  if (diffs.unit === null && diffs.tiers.length === 0) return {};
  return diffs;
}

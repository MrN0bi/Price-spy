import * as cheerio from 'cheerio';

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
  _debug?: any;
}

const CURRENCY_RE = /([$€£¥]|kr)/i;
const PRICE_RE = /([$€£¥]|kr)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i;
const PERIOD_RE =
  /(per\s*month|\/\s*mo|\/\s*month|per\s*year|\/\s*yr|\/\s*year)/i;
const PER_SEAT_RE = /(per\s*(user|seat)|\/\s*user|\/\s*seat)/i;

function parseAmount(text: string): {
  currency: Currency;
  amount: number | undefined;
} {
  const m = text.match(PRICE_RE);
  if (!m) return { currency: 'unknown', amount: undefined };
  const cur = (m[1] || '').toLowerCase();
  const currency: Currency =
    cur === '$'
      ? '$'
      : cur === '€'
      ? '€'
      : cur === '£'
      ? '£'
      : cur === '¥'
      ? '¥'
      : /kr/.test(cur)
      ? 'kr'
      : 'unknown';
  const num = m[2].replace(',', '.');
  const amount = Number.parseFloat(num);
  return { currency, amount: Number.isFinite(amount) ? amount : undefined };
}

function parsePeriod(text: string): Period {
  if (/(year|yr)/i.test(text)) return 'yearly';
  if (/(month|mo)/i.test(text)) return 'monthly';
  if (PERIOD_RE.test(text)) {
    if (/year|yr/i.test(text)) return 'yearly';
    if (/month|mo/i.test(text)) return 'monthly';
  }
  return 'unknown';
}

function extractFeatures(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<any>
): string[] {
  const features: string[] = [];
  root.find('ul li, ol li').each((_, li) => {
    const t = $(li as any)
      .text()
      .trim()
      .replace(/\s+/g, ' ');
    if (t) features.push(t);
  });
  return features.slice(0, 50);
}

function findCardRoots(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<any>
) {
  const candidates: cheerio.Cheerio<any>[] = [];

  container.children().each((_, el) => {
    const node = $(el as any);
    const hasPrice = PRICE_RE.test(node.text());
    if (hasPrice) candidates.push(node);
  });

  if (candidates.length === 0) {
    container.children().each((_, el) => {
      const node = $(el as any);
      const deepHasPrice = node
        .find('*')
        .filter((_, e) => PRICE_RE.test($(e as any).text()))
        .first();
      if (deepHasPrice.length) candidates.push(node);
    });
  }

  if (candidates.length === 0) candidates.push(container);

  return candidates;
}

/**
 * If cssHint is provided, we scope to that selector.
 * If cssHint is empty/undefined, we fall back to heuristics on the whole <body>.
 *
 * nodeIndex (1-based) selects which match of cssHint to use when there are multiple;
 * if omitted, all matches are processed (previous behaviour).
 */
export function extractPricingFromHtml(
  html: string,
  cssHint?: string,
  nodeIndex?: number
): NormalizedPricing {
  const $ = cheerio.load(html);
  let scope: cheerio.Cheerio<any>;
  const debug: any = {};

  if (cssHint && cssHint.trim()) {
    debug.cssHint = cssHint;
    try {
      const matches = $(cssHint as any);
      debug.matchesCount = matches.length;

      if (!matches || matches.length === 0) {
        return {
          unit: 'unknown',
          tiers: [],
          _debug: { ...debug, reason: 'selector_not_found' },
        };
      }

      if (nodeIndex && nodeIndex > 0) {
        const idx = Math.min(
          Math.max(nodeIndex - 1, 0),
          matches.length - 1
        );
        scope = matches.eq(idx);
        debug.nodeIndex = nodeIndex;
        debug.effectiveIndex = idx;
      } else {
        scope = matches;
      }
    } catch {
      scope = $('body');
      debug.invalidSelector = true;
    }
  } else {
    scope = $('body');
    debug.noCssHint = true;
  }

  if (!scope || scope.length === 0) {
    return {
      unit: 'unknown',
      tiers: [],
      _debug: {
        ...debug,
        reason: cssHint ? 'selector_not_found' : 'scope_not_found',
      },
    };
  }

  const containers = scope;
  const tiers: Tier[] = [];

  containers.each((_, containerEl) => {
    const container = $(containerEl as any);
    const cards = findCardRoots($, container);

    cards.forEach((card) => {
      const raw = card
        .text()
        .trim()
        .replace(/\s+/g, ' ');
      const heading = card
        .find('h1,h2,h3,h4,h5,h6')
        .first()
        .text()
        .trim();

      const priceTextEl = card
        .find('*')
        .filter((_, e) => PRICE_RE.test($(e as any).text()))
        .first();
      const priceText = priceTextEl.length ? priceTextEl.text() : raw;

      const { currency, amount } = parseAmount(priceText);
      const period = parsePeriod(priceText);
      const features = extractFeatures($, card);

      const unit =
        PER_SEAT_RE.test(raw)
          ? 'per seat'
          : period !== 'unknown'
          ? 'per month'
          : 'unknown';

      const tier: Tier = {
        name: heading || undefined,
        amount,
        currency,
        period,
        raw,
        features,
      };
      tiers.push(tier);
      debug.last = {
        heading,
        priceText,
        unit,
        hasPrice: typeof amount === 'number',
      };
    });
  });

  const clean = tiers.filter((t) => typeof t.amount === 'number' || t.name);
  return {
    unit: clean.some((t) => PER_SEAT_RE.test(t.raw || ''))
      ? 'per seat'
      : clean.some((t) => t.period === 'monthly')
      ? 'per month'
      : 'unknown',
    tiers: clean,
    _debug: debug,
  };
}

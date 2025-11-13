// lib/diff.ts
import crypto from 'crypto';
import { load, CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element as CheerioElement } from 'domhandler';

/* ---------------------------- hashing utilities --------------------------- */
export function hashContent(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/* ---------------------------------- types --------------------------------- */
export type NormalizedPricing = {
  currency?: string;
  amount?: number;
  period?: 'monthly' | 'annual' | 'one_time' | 'unknown';
  unit?: 'per_user' | 'per_seat' | 'flat' | 'per_unit' | 'unknown';
  tiers?: Array<{ name: string; amount?: number; unit?: string; period?: string }>;
  features?: string[];
  _debug?: {
    cards?: PricingCard[];
    usedHtmlParser: boolean;
  };
};

type PricingCard = {
  planName?: string;
  amount?: number;
  currency?: string;
  cadence?: 'monthly' | 'yearly' | 'one-time' | 'per-user' | string;
  features?: string[];
  ctaText?: string;
  ctaHref?: string;
  rawText: string;
  score: number;
  path: string; // css-like path for debugging
};

/* --------------------------------- regexes -------------------------------- */
const CURRENCY_RE =
  /(?:[$€£¥₹]|USD|EUR|SEK|GBP|JPY|INR|NOK|DKK|CHF|CAD|AUD|kr|SEK)/i;
const AMOUNT_RE = /\b\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\b/;
const PERIOD_RE =
  /\b(per\s*(month|year|user|seat)|\/\s*mo(?:nth)?|\/\s*yr|monthly|annual(?:ly)?|yearly|mo\.?|yr\.?|per\s*månad|per\s*år|månadsvis|årsvis)\b/i;
const CTA_RE =
  /\b(get started|start|try|buy|subscribe|contact sales|choose|select|upgrade|request (?:trial|demo)|get a demo|start deploying|upgrade now)\b/i;
const PLAN_RE =
  /\b(hobby|free|starter|basic|standard|team|pro|business|enterprise|plus|premium|growth)\b/i;

/* ------------------------------- small helpers ---------------------------- */
function looksLikeHtml(s: string) {
  return /<\/?[a-z][\s>]/i.test(s);
}

function cssPath(el: CheerioElement, $: CheerioAPI): string {
  const parts: string[] = [];
  let cur: CheerioElement | undefined = el;
  while (cur && cur.type === 'tag') {
    const tag = cur.tagName;
    const id = $(cur).attr('id');
    const cls = ($(cur).attr('class') || '').split(/\s+/).filter(Boolean)[0];
    let part = tag;
    if (id) part += `#${id}`;
    else if (cls) part += `.${cls}`;
    parts.unshift(part);
    cur = cur.parent as CheerioElement | undefined;
    if (parts.length > 6) break;
  }
  return parts.join('>');
}

function extractText($el: Cheerio<AnyNode>): string {
  return $el.text().replace(/\s+/g, ' ').trim();
}

function hasReplicatedSiblings(node: CheerioElement, $: CheerioAPI): boolean {
  const parent = node.parent as CheerioElement | undefined;
  if (!parent) return false;
  const kids = ($(parent).children().toArray() as AnyNode[]).filter(
    (e) => (e as CheerioElement).type === 'tag'
  ) as CheerioElement[];
  if (kids.length < 3) return false;
  const firstClass = ($(kids[0]).attr('class') || '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  let similar = 0;
  for (const k of kids) {
    const cls = ($(k).attr('class') || '').split(/\s+/).filter(Boolean).join(' ');
    if (cls && cls === firstClass) similar++;
  }
  return similar >= 2;
}

function parseAmountCurrency(text: string): { amount?: number; currency?: string } {
  const curMatch = text.match(CURRENCY_RE);
  const amtMatch = text.match(AMOUNT_RE);
  if (!curMatch || !amtMatch) return {};
  const symbol = curMatch[0];
  const rawAmt = amtMatch[0].replace(/\s/g, '');
  // normalize: "1.234,56" → "1234.56", "1,234.56" → "1234.56", "1 234,56" → "1234.56"
  const normalized = rawAmt
    .replace(/(\d)[,](\d{2})$/, '$1.$2')
    .replace(/[,\s](?=\d{3}\b)/g, '')
    .replace(/\.(?=.*\.)/g, '');
  const amt = Number(normalized);
  if (!isFinite(amt)) return {};
  return { amount: amt, currency: symbol.toUpperCase() };
}

function detectCadence(text: string): PricingCard['cadence'] {
  if (/annual|yearly|\/\s*yr|per\s*year|per\s*år|årsvis/i.test(text)) return 'yearly';
  if (/monthly|\/\s*mo|per\s*month|per\s*månad|månadsvis/i.test(text)) return 'monthly';
  if (/per\s*(user|seat)/i.test(text)) return 'per-user';
  return undefined;
}

function scoreContainer($container: Cheerio<AnyNode>, $: CheerioAPI): number {
  const t = extractText($container);
  let s = 0;
  if (CURRENCY_RE.test(t) && AMOUNT_RE.test(t)) s += 3;
  if (PERIOD_RE.test(t)) s += 2;
  if (/\bfree\b|free\s*forever/i.test(t)) s += 1;
  if (PLAN_RE.test(t)) s += 1;

  const cls = ($container.attr('class') || '') + ' ' + ($container.attr('id') || '');
  if (/\b(price|pricing|plan|tier|package|card|panel)\b/i.test(cls)) s += 2;

  const hasCta =
    $container.find('a,button').filter((_, el: AnyNode) => {
      const $el = $((el as CheerioElement));
      return CTA_RE.test(extractText($el));
    }).length > 0;
  if (hasCta) s += 2;

  if ($container.find('ul li').length >= 3) s += 1;

  const node = $container.get(0) as CheerioElement | undefined;
  if (node && hasReplicatedSiblings(node, $)) s += 2;

  if ($container.find('[itemtype*="Offer"],[itemtype*="AggregateOffer"],[itemtype*="Product"]').length) s += 1;

  return s;
}

/* ---------------------- pick a compact "card" ancestor -------------------- */
function findCompactCardAncestor(
  start: CheerioElement,
  $: CheerioAPI
): CheerioElement {
  const MAX_ASCENT = 6;
  const MAX_TEXT_CHARS = 1200; // typical plan card copy length
  const MIN_TEXT_CHARS = 30;   // ignore tiny wrappers
  const CARD_CLASS_RE = /\b(price|pricing|plan|tier|package|card|panel|hero|grid|column)\b/i;

  let cur: CheerioElement | undefined = start;
  let best: CheerioElement | undefined = start;

  for (let i = 0; i < MAX_ASCENT && cur && cur.parent; i++) {
    const $cur = $(cur);
    const text = $cur.text().replace(/\s+/g, ' ').trim();
    const cls = ($cur.attr('class') || '') + ' ' + ($cur.attr('id') || '');
    const looksCard =
      CARD_CLASS_RE.test(cls) || $cur.find('a,button').length > 0 || $cur.find('ul li').length >= 3;

    const lenOK = text.length >= MIN_TEXT_CHARS && text.length <= MAX_TEXT_CHARS;
    if (looksCard && lenOK) best = cur;

    // stop climbing if this ancestor is already huge
    if (text.length > MAX_TEXT_CHARS * 1.5) break;

    cur = cur.parent as CheerioElement | undefined;
  }
  return best || start;
}

/* --------- find repeated siblings under a root (cards in a grid) ---------- */
function signature(el: CheerioElement, $: CheerioAPI) {
  const cls = ($(el).attr('class') || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .sort()
    .join('.');
  const tag = el.tagName || '';
  return `${tag}.${cls}`;
}

function pickRepeatedChildren(root: CheerioElement, $: CheerioAPI): CheerioElement[] {
  const kids = ($(root).children().toArray() as AnyNode[]).filter(
    (e) => (e as CheerioElement).type === 'tag'
  ) as CheerioElement[];
  if (kids.length >= 2) {
    const counts = new Map<string, number>();
    for (const k of kids) {
      const sig = signature(k, $);
      counts.set(sig, (counts.get(sig) || 0) + 1);
    }
    const bestSig = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (bestSig && bestSig[1] >= 2) return kids.filter((k) => signature(k, $) === bestSig[0]);
  }

  const grand: CheerioElement[] = [];
  for (const k of kids) {
    const gkids = ($(k).children().toArray() as AnyNode[]).filter(
      (e) => (e as CheerioElement).type === 'tag'
    ) as CheerioElement[];
    grand.push(...gkids);
  }
  if (grand.length >= 2) {
    const counts = new Map<string, number>();
    for (const k of grand) {
      const sig = signature(k, $);
      counts.set(sig, (counts.get(sig) || 0) + 1);
    }
    const bestSig = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (bestSig && bestSig[1] >= 2) return grand.filter((k) => signature(k, $) === bestSig[0]);
  }

  return [root];
}

/* ------------------------------- main extract ----------------------------- */
function extractCardsFromHtml(html: string): PricingCard[] {
  const $ = load(html);

  // sanitize
  $('script, style, noscript, template, svg, head, link, meta').remove();
  $('[aria-hidden="true"], [hidden], [style*="display:none"], [style*="visibility:hidden"]').remove();

  const candidates: CheerioElement[] = [];

  $('*:not(script):not(style)').each((_, el: AnyNode) => {
    const elem = el as CheerioElement;
    const $el = $(elem);
    const text = $el.text();
    if (!text) return;

    const hasSignals =
      (CURRENCY_RE.test(text) && AMOUNT_RE.test(text)) || PERIOD_RE.test(text) || PLAN_RE.test(text) || CTA_RE.test(text);

    if (hasSignals) {
      const cur = findCompactCardAncestor(elem, $);
      const tag = cur.tagName?.toLowerCase?.() || '';
      if (tag === 'html' || tag === 'body' || tag === 'main') return;
      candidates.push(cur);
    }
  });

  // de-dupe by cssPath
  const seen = new Set<string>();
  const unique = candidates.filter((el) => {
    const key = cssPath(el, $);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // cluster by parent & keep densest grid
  type Cluster = {
    parent: CheerioElement;
    items: CheerioElement[];
    path: string;
    textLen: number;
    scoreSum: number;
  };

  const clusters = new Map<string, Cluster>();
  for (const el of unique) {
    const parent = (el.parent as CheerioElement) || el;
    const path = cssPath(parent, $);
    const tlen = $(parent).text().replace(/\s+/g, ' ').trim().length;
    if (!clusters.has(path)) clusters.set(path, { parent, items: [], path, textLen: tlen, scoreSum: 0 });
    clusters.get(path)!.items.push(el);
  }

  for (const c of clusters.values()) {
    let sum = 0;
    for (const el of c.items) sum += scoreContainer($(el), $);
    c.scoreSum = sum;
  }

  const bestCluster = [...clusters.values()]
    .filter((c) => c.items.length >= 2)
    .sort(
      (a, b) =>
        b.scoreSum / Math.max(600, b.textLen) - a.scoreSum / Math.max(600, a.textLen)
    )[0];

  const baseList = bestCluster ? bestCluster.items : unique;

  // split cluster parent into repeated children (real cards)
  let itemNodes: CheerioElement[] = baseList;
  if (bestCluster) {
    const repeated = pickRepeatedChildren(bestCluster.parent, $);
    if (repeated.length >= 2) itemNodes = repeated;
  }

  // prefer grids: require repeated class sigs
  function classSig($el: Cheerio<AnyNode>) {
    return ($el.attr('class') || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .sort()
      .join('.');
  }
  const sigCounts = new Map<string, number>();
  for (const el of itemNodes) {
    const sig = classSig($(el));
    sigCounts.set(sig, (sigCounts.get(sig) || 0) + 1);
  }
  const scoped = itemNodes.filter((el) => (sigCounts.get(classSig($(el))) || 0) >= 2);

  const cards: PricingCard[] = (scoped.length ? scoped : itemNodes)
    .map((el) => {
      const $el: Cheerio<AnyNode> = $(el);
      const text = extractText($el);
      const { amount, currency } = parseAmountCurrency(text);
      const cadence = detectCadence(text);
      const heading =
        $el.find('h1,h2,h3,h4,[class*="plan"],[class*="tier"]').first().text().trim() ||
        $el.find('strong,b').first().text().trim() ||
        text.split(' ').slice(0, 6).join(' ');

      const features = $el
        .find('ul li')
        .map((_, li: AnyNode) => $(li as CheerioElement).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter((s: string) => s && s.length < 160);

      const cta = $el
        .find('a,button')
        .filter((_, e: AnyNode) => CTA_RE.test($(e as CheerioElement).text()))
        .first();

      const ctaText = cta.text().trim() || undefined;
      const ctaHref = (cta.attr('href') || '').trim() || undefined;

      const score = scoreContainer($el, $);

      return {
        planName: heading || undefined,
        amount,
        currency,
        cadence,
        features,
        ctaText,
        ctaHref,
        rawText: text,
        score,
        path: cssPath(el, $),
      };
    })
    .filter((c) => c.rawText.length >= 30 && c.rawText.length <= 1200)
    .filter((c) => !!(c.ctaText || /free\b/i.test(c.rawText) || (c.currency && c.amount !== undefined)))
    .filter((c) => c.score >= 5)
    .sort((a, b) => b.score - a.score);

  return cards;
}

/* -------------------------- normalization to JSON ------------------------- */
function normalizeFromCards(cards: PricingCard[]): NormalizedPricing {
  const tiers = cards.map((c) => ({
    name: c.planName || 'Plan',
    amount: c.amount,
    unit: c.cadence === 'per-user' ? 'per_user' : undefined,
    period: c.cadence === 'yearly' ? 'annual' : c.cadence === 'monthly' ? 'monthly' : undefined,
  }));

  const top = cards.find(c => typeof c.amount === 'number') || cards[0];
  const currency = top?.currency;
  const amount = top?.amount;

  let period: NormalizedPricing['period'] = 'unknown';
  if (cards.some((c) => c.cadence === 'yearly')) period = 'annual';
  else if (cards.some((c) => c.cadence === 'monthly')) period = 'monthly';

  let unit: NormalizedPricing['unit'] = 'unknown';
  if (cards.some((c) => c.cadence === 'per-user')) unit = 'per_user';
  else if (cards.some((c) => /unlimited|flat/i.test(c.rawText))) unit = 'flat';

  const features = Array.from(new Set(cards.flatMap((c) => c.features || []))).slice(0, 25);

  return {
    currency,
    amount,
    period,
    unit,
    tiers,
    features,
    _debug: { cards, usedHtmlParser: true },
  };
}

/* ------------------------------ plaintext path ---------------------------- */
function normalizeFromPlainText(text: string): NormalizedPricing {
  const cleaned = (text || '').toLowerCase().replace(/\s+/g, ' ');
  const priceRegex = /([$€£]|kr)\s?(\d+[\d.,]*)/;
  const p = cleaned.match(priceRegex);
  const currency = p ? p[1] : undefined;
  const amount = p ? Number(p[2].replace(/[.,](?=\d{3}\b)/g, '').replace(/[, ]/g, '')) : undefined;

  let period: NormalizedPricing['period'] = 'unknown';
  if (/per\s?month|\/mo|monthly|per\s*månad|månadsvis/.test(cleaned)) period = 'monthly';
  else if (/per\s?year|\/yr|annual|yearly|per\s*år|årsvis/.test(cleaned)) period = 'annual';

  let unit: NormalizedPricing['unit'] = 'unknown';
  if (/per\s?(user|seat)/.test(cleaned)) unit = 'per_user';
  else if (/per\s?(credit|api|unit)/.test(cleaned)) unit = 'per_unit';
  else if (/flat|unlimited/.test(cleaned)) unit = 'flat';

  const tiers: Array<{ name: string; amount?: number; unit?: string; period?: string }> = [];
  const tierRegex =
    /(hobby|free|starter|basic|standard|team|pro|business|enterprise|plus|premium|growth)[^$€£kr\n]{0,50}([$€£]|kr)?\s?(\d+[\d.,]*)?/gi;
  let m: RegExpExecArray | null;
  while ((m = tierRegex.exec(cleaned))) {
    const name = m[1];
    const priceStr = m[3];
    const amtNum = priceStr
      ? Number(priceStr.replace(/[.,](?=\d{3}\b)/g, '').replace(/[, ]/g, ''))
      : Number.NaN;

    tiers.push({
      name,
      amount: Number.isFinite(amtNum) ? amtNum : undefined,
      unit: undefined,
      period: undefined,
    });
  }

  const features: string[] = [];
  [
    'sso',
    'single sign-on',
    'audit',
    'sla',
    'api',
    'scim',
    'roles',
    'soc 2',
    'security',
    'analytics',
    'support',
  ].forEach((f) => {
    if (cleaned.includes(f)) features.push(f);
  });

  return {
    currency,
    amount,
    period,
    unit,
    tiers,
    features,
    _debug: { usedHtmlParser: false },
  };
}

/* ------------------------------ public API -------------------------------- */
export function extractPricing(htmlOrText: string): NormalizedPricing {
  if (!htmlOrText)
    return { period: 'unknown', unit: 'unknown', tiers: [], features: [], _debug: { usedHtmlParser: false } };
  if (looksLikeHtml(htmlOrText)) {
    const cards = extractCardsFromHtml(htmlOrText);
    if (cards.length) return normalizeFromCards(cards);
  }
  return normalizeFromPlainText(htmlOrText);
}

/* ---------------------------------- diff ---------------------------------- */
export function shallowDiff(a: NormalizedPricing, b: NormalizedPricing) {
  return {
    currency: a.currency !== b.currency ? [a.currency, b.currency] : undefined,
    amount: a.amount !== b.amount ? [a.amount, b.amount] : undefined,
    period: a.period !== b.period ? [a.period, b.period] : undefined,
    unit: a.unit !== b.unit ? [a.unit, b.unit] : undefined,
    tier_count:
      (a.tiers?.length || 0) !== (b.tiers?.length || 0) ? [a.tiers?.length, b.tiers?.length] : undefined,
  };
}

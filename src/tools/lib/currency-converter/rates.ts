export const API = 'https://api.frankfurter.dev/v1';

/** Rates against EUR (the ECB publishes everything relative to the euro), EUR itself included as 1. */
export type Rates = Record<string, number>;

export interface RateCache {
  /** ECB reference date, YYYY-MM-DD */
  date: string;
  rates: Rates;
  /** when we fetched it, ms since epoch */
  fetchedAt: number;
}

export const CACHE_TTL = 12 * 60 * 60 * 1000;

export const isFresh = (cache: RateCache, now: number) => now - cache.fetchedAt < CACHE_TTL;

/** Normalises a Frankfurter /latest response (base EUR) into a cache entry. */
export function toCache(json: unknown, now: number): RateCache {
  const j = json as { base?: string; date?: string; rates?: Record<string, unknown> };
  if (j?.base !== 'EUR' || typeof j.date !== 'string' || !j.rates) throw new Error('Unexpected response from the rates service');
  const rates: Rates = { EUR: 1 };
  for (const [code, v] of Object.entries(j.rates)) if (typeof v === 'number' && v > 0) rates[code] = v;
  return { date: j.date, rates, fetchedAt: now };
}

export function readCache(raw: string | null): RateCache | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as RateCache;
    return typeof c.date === 'string' && typeof c.fetchedAt === 'number' && c.rates?.EUR === 1 ? c : null;
  } catch {
    return null;
  }
}

export function convert(amount: number, from: string, to: string, rates: Rates): number | null {
  const a = rates[from];
  const b = rates[to];
  return a && b ? (amount / a) * b : null;
}

/**
 * Reads amounts typed in either convention: "1,234.56", "1.234,56", "1 234,5", "12,5".
 * A lone separator followed by exactly three digits is treated as a thousands separator.
 */
export function parseAmount(input: string): number | null {
  let s = input.replace(/[\s_'  ]/g, '').replace(/^[^\d.,-]+|[^\d.,]+$/g, '');
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.split(dec === '.' ? ',' : '.').join('').replace(',', '.');
  } else {
    const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : '';
    if (sep) {
      const parts = s.split(sep);
      const grouping = parts.length > 2 || (parts[1].length === 3 && /[1-9]/.test(parts[0]));
      s = grouping ? parts.join('') : parts.join('.');
    }
  }
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const defaultDigits = (code: string) => new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;

/** Extra decimals for tiny amounts so 1 JPY in USD reads $0.0063 rather than $0.01. */
export function fractionDigits(value: number, code: string): number {
  const base = defaultDigits(code);
  const abs = Math.abs(value);
  if (abs === 0 || abs >= 1) return base;
  return Math.min(6, Math.max(base, 2 - Math.floor(Math.log10(abs))));
}

export function formatMoney(value: number, code: string, locale?: string): string {
  const d = fractionDigits(value, code);
  return new Intl.NumberFormat(locale, { style: 'currency', currency: code, minimumFractionDigits: Math.min(d, defaultDigits(code)), maximumFractionDigits: d }).format(value);
}

/** A unit rate such as 0.8938 or 176.15, with 4–5 significant digits. */
export function formatRate(rate: number, locale?: string): string {
  // below 1, count significant digits so 1 IDR = 0.00004896 EUR doesn't round to 0
  if (Math.abs(rate) < 1 && rate !== 0) return new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(rate);
  const intDigits = Math.max(1, Math.floor(Math.log10(Math.abs(rate))) + 1);
  return new Intl.NumberFormat(locale, { maximumFractionDigits: Math.max(0, Math.min(6, 5 - intDigits)), minimumFractionDigits: 0 }).format(rate);
}

/** Flag emoji from regional indicators; the euro gets the EU flag. Unknown codes get none. */
export function flag(code: string): string {
  const region = code === 'EUR' ? 'EU' : code.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(region) || region[0] === 'X') return '';
  return String.fromCodePoint(...[...region].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

const EUROZONE = new Set('AT BE HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES BG'.split(' '));

/** Guesses the visitor's currency from a locale like "en-GB"; null when we can't tell. */
export function currencyForLocale(locale: string, codes: string[]): string | null {
  const region = locale.match(/[-_]([A-Z]{2})\b/)?.[1];
  if (!region) return null;
  if (EUROZONE.has(region)) return 'EUR';
  return codes.find((c) => c !== 'EUR' && c.startsWith(region)) ?? null;
}

/** Ranks currencies against a search: exact code, then code prefix, then name match. */
export function searchCurrencies(query: string, codes: string[], nameOf: (code: string) => string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return codes;
  const scored: [string, number][] = [];
  for (const c of codes) {
    const code = c.toLowerCase();
    const name = nameOf(c).toLowerCase();
    const score = code === q ? 0 : code.startsWith(q) ? 1 : name.split(/\s+/).some((w) => w.startsWith(q)) ? 2 : name.includes(q) ? 3 : -1;
    if (score >= 0) scored.push([c, score]);
  }
  return scored.sort((a, b) => a[1] - b[1]).map(([c]) => c);
}

export interface Point {
  date: string;
  value: number;
}

/** Turns a Frankfurter time-series response (single symbol) into ordered points. */
export function toSeries(json: unknown, to: string): Point[] {
  const rates = (json as { rates?: Record<string, Record<string, number>> })?.rates;
  if (!rates) throw new Error('Unexpected response from the rates service');
  return Object.entries(rates)
    .filter(([, r]) => typeof r?.[to] === 'number')
    .map(([date, r]) => ({ date, value: r[to] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function isoDaysAgo(days: number, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  return d.toISOString().slice(0, 10);
}

/** SVG line and area paths for a sparkline that fills w×h with `pad` px breathing room top and bottom. */
export function sparkPaths(points: Point[], w: number, h: number, pad: number) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (points.length < 2 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number) => (max === min ? h / 2 : pad + (1 - (v - min) / span) * (h - pad * 2));
  const coords = points.map((p, i) => [x(i), y(p.value)] as const);
  const line = coords.map(([cx, cy], i) => `${i ? 'L' : 'M'}${cx.toFixed(2)} ${cy.toFixed(2)}`).join(' ');
  const area = coords.length ? `${line} L${coords.at(-1)![0].toFixed(2)} ${h} L${coords[0][0].toFixed(2)} ${h} Z` : '';
  return { line, area, coords, min, max };
}

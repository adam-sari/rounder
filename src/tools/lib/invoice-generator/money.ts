/*
 * Invoice math in integer minor units (cents for USD, yen for JPY…). Inputs stay
 * the strings people typed; products go through BigInt so nothing drifts.
 */

/** quantities and percentages keep up to 4 decimals: 8.875% is stored as 88_750 */
export const SCALE = 10_000;
const PERCENT = BigInt(100 * SCALE);

/**
 * "1,234.50", "1.234,50", "12,5", "$ 40", "15%" → the value × 10^digits as an
 * integer, rounded half away from zero; null when it isn't a number. A lone
 * comma followed by exactly three digits reads as a thousands separator.
 */
export function parseScaled(input: string, digits: number): number | null {
  const s = input.replace(/[^\d.,-]/g, '');
  if (!/^-?[\d.,]*\d[\d.,]*$/.test(s)) return null;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.lastIndexOf('.');
  const comma = body.lastIndexOf(',');
  let sep = '';
  if (dot >= 0 && comma >= 0) sep = dot > comma ? '.' : ',';
  else if (comma >= 0) sep = body.split(',').length === 2 && !/,\d{3}$/.test(body) ? ',' : '';
  else if (dot >= 0) sep = body.split('.').length === 2 ? '.' : '';
  const at = sep ? body.lastIndexOf(sep) : body.length;
  const int = body.slice(0, at).replace(/[.,]/g, '');
  const frac = body.slice(at + 1);
  if (int.length > 15) return null;
  const kept = frac.slice(0, digits).padEnd(digits, '0');
  let value = BigInt(int || '0') * 10n ** BigInt(digits) + BigInt(kept || '0');
  if (frac.length > digits && frac[digits] >= '5') value += 1n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return neg ? -Number(value) : Number(value);
}

/** n / d rounded half away from zero (d > 0) */
export function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  return 2n * (r < 0n ? -r : r) >= d ? q + (n < 0n ? -1n : 1n) : q;
}

/**
 * Splits `total` across `weights` in proportion, in whole units, handing the
 * leftover units to the largest remainders so the parts always add up exactly.
 */
export function allocate(total: number, weights: number[]): number[] {
  const w = weights.map((x) => BigInt(Math.max(0, x)));
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n || total === 0) return weights.map(() => 0);
  const t = BigInt(total);
  const parts = w.map((x) => (t * x) / sum);
  let rest = t - parts.reduce((a, b) => a + b, 0n);
  const order = w.map((x, i) => [i, (t * x) % sum] as const).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0] - b[0]));
  const step = rest < 0n ? -1n : 1n;
  for (let k = 0; rest !== 0n; k = (k + 1) % order.length) {
    if (w[order[k][0]] === 0n) continue;
    parts[order[k][0]] += step;
    rest -= step;
  }
  return parts.map(Number);
}

export type TaxMode = 'none' | 'global' | 'line';
export type Rounding = 'line' | 'total';

export interface TotalsInput {
  items: { qty: string; price: string; tax: string }[];
  /** the currency's minor-unit digits (2 for USD, 0 for JPY, 3 for KWD) */
  digits: number;
  taxMode: TaxMode;
  taxRate: string;
  discountKind: 'percent' | 'amount';
  discount: string;
  paid: string;
  /** round tax on every line, or once per tax rate on the summed lines */
  rounding: Rounding;
}

export interface TaxLine {
  /** percent × SCALE */
  rate: number;
  base: number;
  amount: number;
}

export interface Totals {
  /** each line's qty × price, in minor units */
  lines: number[];
  subtotal: number;
  discount: number;
  taxes: TaxLine[];
  tax: number;
  total: number;
  paid: number;
  due: number;
}

const rateOf = (s: string) => Math.max(0, parseScaled(s, 4) ?? 0);

export function computeTotals(input: TotalsInput): Totals {
  const lines = input.items.map((it) => {
    const qty = parseScaled(it.qty, 4) ?? 0;
    const price = parseScaled(it.price, input.digits) ?? 0;
    return Number(divRound(BigInt(qty) * BigInt(price), BigInt(SCALE)));
  });
  const subtotal = lines.reduce((a, b) => a + b, 0);

  let discount = 0;
  if (subtotal > 0) {
    discount = input.discountKind === 'percent'
      ? Number(divRound(BigInt(subtotal) * BigInt(Math.min(rateOf(input.discount), 100 * SCALE)), PERCENT))
      : Math.min(subtotal, Math.max(0, parseScaled(input.discount, input.digits) ?? 0));
  }
  // the discount comes off each charge in proportion, so every tax rate is applied to the right base
  const off = allocate(discount, lines);

  const groups = new Map<number, { base: bigint; amount: bigint }>();
  input.items.forEach((it, i) => {
    const rate = input.taxMode === 'line' ? rateOf(it.tax) : input.taxMode === 'global' ? rateOf(input.taxRate) : 0;
    if (!rate) return;
    const base = BigInt(lines[i] - off[i]);
    const g = groups.get(rate) ?? { base: 0n, amount: 0n };
    g.base += base;
    if (input.rounding === 'line') g.amount += divRound(base * BigInt(rate), PERCENT);
    groups.set(rate, g);
  });
  const taxes = [...groups]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, g]) => ({ rate, base: Number(g.base), amount: Number(input.rounding === 'line' ? g.amount : divRound(g.base * BigInt(rate), PERCENT)) }));
  const tax = taxes.reduce((a, t) => a + t.amount, 0);
  const total = subtotal - discount + tax;
  const paid = parseScaled(input.paid, input.digits) ?? 0;
  return { lines, subtotal, discount, taxes, tax, total, paid, due: total - paid };
}

const digitCache = new Map<string, number>();

/** minor-unit digits for an ISO currency code (2 when unknown) */
export function currencyDigits(code: string): number {
  let d = digitCache.get(code);
  if (d === undefined) {
    try {
      d = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      d = 2;
    }
    digitCache.set(code, d);
  }
  return d;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** 123456 minor units → "$1,234.56" in the given locale */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const digits = currencyDigits(currency);
  const key = `${locale}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    } catch {
      f = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    formatters.set(key, f);
  }
  // narrow no-break spaces (fr, ru…) become plain no-break spaces, which every PDF font can draw
  return f.format(minor / 10 ** digits).replace(/ /g, ' ');
}

/** scaled percent (SCALE) → "8.875%" */
export function formatRate(rate: number): string {
  return `${String(rate / SCALE)}%`;
}

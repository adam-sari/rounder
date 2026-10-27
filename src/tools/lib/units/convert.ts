import type { Unit, UnitCategory } from './units';

export function toBase(value: number, unit: Unit): number {
  if (unit.inverse) return unit.factor / value;
  return (value + (unit.offset ?? 0)) * unit.factor;
}

export function fromBase(base: number, unit: Unit): number {
  if (unit.inverse) return unit.factor / base;
  return base / unit.factor - (unit.offset ?? 0);
}

export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  // stay linear where possible so 1 in → cm is computed as 0.0254 / 0.01, not via an offset
  if (!from.inverse && !to.inverse && !from.offset && !to.offset) return (value * from.factor) / to.factor;
  return fromBase(toBase(value, from), to);
}

/** largest digit count we trust from a double after a couple of multiplications */
const MAX_SIG = 15;

const trimZeros = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);

/**
 * Plain, parseable number: rounded to `sig` significant digits but never rounding away
 * whole-number digits, so 0.1 + 0.2 shows as 0.3 and 123456789 stays 123456789.
 */
export function formatNumber(n: number, sig = 6): string {
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-6) {
    const [m, e] = n.toExponential(Math.min(sig, MAX_SIG) - 1).split('e');
    return `${trimZeros(m)}e${e.replace('+', '')}`;
  }
  const intDigits = abs >= 1 ? String(Math.floor(abs)).length : 0;
  const s = String(Number(n.toPrecision(Math.min(MAX_SIG, Math.max(sig, intDigits)))));
  return s === '-0' ? '0' : s;
}

const SUPER: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** formatNumber for reading: thousands separators and × 10ⁿ instead of e-notation */
export function prettyNumber(n: number, sig = 6): string {
  const s = formatNumber(n, sig);
  if (!s) return '—';
  const [m, e] = s.split('e');
  if (e !== undefined) return `${m} × 10${[...e].map((c) => SUPER[c]).join('')}`;
  const [int, frac] = m.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** true when the value needs more than `sig` digits, i.e. the shown number is rounded */
export const isRounded = (n: number, sig: number) => formatNumber(n, sig) !== formatNumber(n, MAX_SIG);

const VULGAR: Record<string, number> = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };

/** "1,5" and "1.250,5" use a decimal comma; "1,250" and "1,250.5" group thousands */
function commas(s: string): string {
  if (/^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(s)) return s.replace(/\./g, '').replace(',', '.');
  if (/^[+-]?(\d*,\d{1,2}|\d*,\d{4,}|0,\d+)$/.test(s)) return s.replace(',', '.');
  return s.replace(/,/g, '');
}

/**
 * Reads what people actually type: "1,250.5", "1,5", "2e6", "-40", "3/4", "1 1/2", "1½".
 * Returns null for an empty field (or a lone sign still being typed) and NaN for something that isn't a number.
 */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/_/g, '').replace(/[−–]/g, '-');
  if (/^[+-]?\.?$/.test(s)) return null;
  s = commas(s);
  const vulgar = s.match(/^([+-]?)(\d*)\s*([½⅓⅔¼¾⅛⅜⅝⅞])$/);
  if (vulgar) return (vulgar[1] === '-' ? -1 : 1) * (Number(vulgar[2] || 0) + VULGAR[vulgar[3]]);
  const mixed = s.match(/^([+-]?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return (mixed[1] === '-' ? -1 : 1) * (Number(mixed[2]) + ratio(mixed[3], mixed[4]));
  const frac = s.match(/^([+-]?)(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  if (frac) return (frac[1] === '-' ? -1 : 1) * ratio(frac[2], frac[3]);
  s = s.replace(/\s+/g, '');
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? Number(s) : NaN;
}

const ratio = (a: string, b: string) => (Number(b) === 0 ? NaN : Number(a) / Number(b));

const num = (n: number) => formatNumber(n, 9);
/** digits a constant needs, to pick the friendlier way to write a formula */
const weight = (n: number) => num(n).replace(/e.*$/, '').replace(/[-.]/g, '').replace(/^0+/, '').length;
const whole = (n: number) => Number.isInteger(Number(num(n)));

function scale(term: string, k: number): string {
  if (whole(k)) return k === 1 ? term : `${term} × ${num(k)}`;
  // "÷ 2.54" and "÷ 100" read better than "× 0.393700787" and "× 0.01"
  return whole(1 / k) || weight(1 / k) < weight(k) ? `${term} ÷ ${num(1 / k)}` : `${term} × ${num(k)}`;
}

/** a human formula such as "°F = °C × 1.8 + 32" or "in = cm ÷ 2.54" */
export function formula(from: Unit, to: Unit): string {
  const lhs = `${to.symbol} =`;
  if (from.inverse !== to.inverse) return `${lhs} ${num(convert(1, from, to))} ÷ ${from.symbol}`;
  const k = from.inverse ? to.factor / from.factor : from.factor / to.factor;
  const offset = from.inverse ? 0 : convert(0, from, to);
  if (Math.abs(offset) < 1e-9) return `${lhs} ${scale(from.symbol, k)}`;
  // to = from × k + offset, or (from − zero) × k when that reads better (°C = (°F − 32) ÷ 1.8)
  const zero = -offset / k;
  if (weight(offset) <= weight(zero)) return `${lhs} ${scale(from.symbol, k)} ${offset < 0 ? '−' : '+'} ${num(Math.abs(offset))}`;
  return `${lhs} ${scale(`(${from.symbol} ${zero < 0 ? '+' : '−'} ${num(Math.abs(zero))})`, k)}`;
}

// µ becomes u so "µm" matches "um" instead of collapsing to "m" and outranking the meter
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[µμ]/g, 'u').replace(/[^a-z0-9"']/g, '');

export interface UnitMatch {
  category: UnitCategory;
  unit: Unit;
}

/** units in `scope` matching a query, best matches first (exact, then prefix, then anywhere) */
export function searchUnits(query: string, scope: UnitCategory[]): UnitMatch[] {
  const q = norm(query);
  const all = scope.flatMap((category) => category.units.map((unit) => ({ category, unit })));
  if (!q) return all;
  const scored: [UnitMatch, number][] = [];
  for (const m of all) {
    const { name, plural, symbol, aliases = [] } = m.unit;
    let best = Infinity;
    for (const term of [symbol, m.unit.id, name, plural, ...aliases]) {
      const t = norm(term);
      if (t === q) best = 0;
      else if (t.startsWith(q) || term.toLowerCase().split(/[\s(-]+/).some((w) => norm(w).startsWith(q))) best = Math.min(best, 1);
      else if (t.includes(q)) best = Math.min(best, 2);
    }
    if (best < Infinity) scored.push([m, best]);
  }
  // sort is stable, so equal scores keep the catalog order
  return scored.sort((a, b) => a[1] - b[1]).map(([m]) => m);
}

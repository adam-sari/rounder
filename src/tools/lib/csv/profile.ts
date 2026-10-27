export type ColumnType = 'number' | 'date' | 'boolean' | 'text' | 'empty';

const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const GROUPED = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const BOOL = /^(?:true|false|yes|no)$/i;

/** "1,234.5" → 1234.5; anything that isn't a plain number → NaN */
export function toNumber(s: string) {
  const t = s.trim();
  if (NUM.test(t)) return Number(t);
  if (GROUPED.test(t)) return Number(t.replace(/,/g, ''));
  return NaN;
}

/** ISO dates only ("2024-03-01", "2024-03-01 09:30"): 03/01/2024 could be March or January */
export function toTime(s: string) {
  const t = s.trim();
  return ISO_DATE.test(t) ? Date.parse(t.replace(' ', 'T')) : NaN;
}

/** The type every non-empty value agrees on, or text */
export function detectType(values: string[]): ColumnType {
  let seen = 0;
  let num = true;
  let date = true;
  let bool = true;
  for (const v of values) {
    if (!v.trim()) continue;
    seen++;
    if (num && Number.isNaN(toNumber(v))) num = false;
    if (date && Number.isNaN(toTime(v))) date = false;
    if (bool && !BOOL.test(v.trim())) bool = false;
    if (!num && !date && !bool) return 'text';
  }
  if (!seen) return 'empty';
  return num ? 'number' : date ? 'date' : bool ? 'boolean' : 'text';
}

/** Up to `max` values spread evenly through a column, for cheap type detection */
export function sampleColumn(rows: (string[] | null)[], col: number, max = 1000) {
  const step = Math.max(1, Math.floor(rows.length / max));
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i];
    if (r) out.push(r[col] ?? '');
  }
  return out;
}

export interface ColumnStats {
  count: number;
  empty: number;
  unique: number;
  /** most repeated values, only when something repeats */
  top: [string, number][];
  /** smallest / largest value (numbers) or earliest / latest (dates), as written in the file */
  min?: string;
  max?: string;
  mean?: number;
  sum?: number;
}

export function columnStats(values: string[], type: ColumnType): ColumnStats {
  const counts = new Map<string, number>();
  let empty = 0;
  let sum = 0;
  let numeric = 0;
  let lo = Infinity;
  let hi = -Infinity;
  let min: string | undefined;
  let max: string | undefined;
  const key = type === 'number' ? toNumber : type === 'date' ? toTime : null;

  for (const v of values) {
    if (!v.trim()) {
      empty++;
      continue;
    }
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!key) continue;
    const n = key(v);
    if (Number.isNaN(n)) continue;
    numeric++;
    sum += n;
    if (n < lo) [lo, min] = [n, v];
    if (n > hi) [hi, max] = [n, v];
  }

  // a single pass for the top three beats sorting 100k unique values
  const top: [string, number][] = [];
  for (const entry of counts) {
    if (entry[1] < 2) continue;
    const at = top.findIndex((t) => entry[1] > t[1]);
    if (at >= 0) top.splice(at, 0, entry);
    else top.push(entry);
    if (top.length > 3) top.pop();
  }

  const stats: ColumnStats = { count: values.length - empty, empty, unique: counts.size, top, min, max };
  if (type === 'number' && numeric) Object.assign(stats, { sum, mean: sum / numeric });
  return stats;
}

/**
 * Row order for sorting a column. Numbers and dates compare by value, text in natural
 * order ("item 2" before "item 10"); blanks always go last whichever way you sort.
 */
export function sortOrder(values: string[], type: ColumnType, desc: boolean): Uint32Array {
  const n = values.length;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const dir = desc ? -1 : 1;

  if (type === 'number' || type === 'date') {
    const parse = type === 'number' ? toNumber : toTime;
    const keys = new Float64Array(n);
    for (let i = 0; i < n; i++) keys[i] = parse(values[i]);
    return idx.sort((a, b) => {
      const x = keys[a];
      const y = keys[b];
      const xn = Number.isNaN(x);
      const yn = Number.isNaN(y);
      if (xn || yn) return xn === yn ? a - b : xn ? 1 : -1;
      return (x - y) * dir || a - b;
    });
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const blank = values.map((v) => !v.trim());
  return idx.sort((a, b) => {
    if (blank[a] || blank[b]) return blank[a] === blank[b] ? a - b : blank[a] ? 1 : -1;
    return collator.compare(values[a], values[b]) * dir || a - b;
  });
}

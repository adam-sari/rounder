/** "1,250.5", " 20 % ", "−5" or "-3e2" → number; null for empty or junk */
export function parseNum(s: string): number | null {
  // U+2212 is the true minus sign, common in pasted figures
  const t = s.replace(/[,\s%$€£]/g, '').replace(/−/g, '-');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t) ? Number(t) : null;
}

const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
const tiny = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 });

/** readable number without float noise: 0.1 + 0.2 → "0.3", 1234.5 → "1,234.5" */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const clean = Number(n.toPrecision(12));
  if (clean === 0) return '0';
  return Math.abs(clean) < 0.001 ? tiny.format(clean) : plain.format(clean);
}

/** what is p% of y */
export const percentOf = (p: number, y: number) => (p / 100) * y;

/** x is what percent of y */
export const whatPercent = (x: number, y: number) => (y === 0 ? null : (x / y) * 100);

/** percent change from a to b, measured against the size of a */
export const percentChange = (a: number, b: number) => (a === 0 ? null : ((b - a) / Math.abs(a)) * 100);

/** x raised (dir 1) or lowered (dir -1) by p% */
export const applyPercent = (x: number, p: number, dir: 1 | -1) => x * (1 + (dir * p) / 100);

/** the starting value that became `result` after p% was added (dir 1) or taken off (dir -1) */
export function reversePercent(result: number, p: number, dir: 1 | -1): number | null {
  const factor = 1 + (dir * p) / 100;
  return factor === 0 ? null : result / factor;
}

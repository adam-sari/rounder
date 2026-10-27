/** returns a uniformly random unsigned 32-bit integer */
export type Rand32 = () => number;

const TWO32 = 2 ** 32;
const TWO53 = 2 ** 53;

let pool = new Uint32Array(256);
let used = pool.length;

/** crypto.getRandomValues, fetched 256 values at a time so big batches stay fast */
export const cryptoRand32: Rand32 = () => {
  if (used === pool.length) {
    crypto.getRandomValues(pool);
    used = 0;
  }
  return pool[used++];
};

/**
 * Unbiased integer in [0, n), for any n up to 2^53. Draws that fall in the uneven
 * tail of the range are thrown away and redrawn (rejection sampling), so every
 * value is exactly equally likely instead of `% n` favouring the small ones.
 */
export function randBelow(n: number, next: Rand32 = cryptoRand32): number {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`randBelow needs a whole number of at least 1, got ${n}`);
  if (n <= TWO32) {
    const limit = TWO32 - (TWO32 % n);
    let x: number;
    do x = next();
    while (x >= limit);
    return x % n;
  }
  const limit = TWO53 - (TWO53 % n);
  let x: number;
  // 21 high bits + 32 low bits = a 53-bit draw
  do x = (next() & 0x1fffff) * TWO32 + next();
  while (x >= limit);
  return x % n;
}

/** unbiased integer in [min, max], both inclusive */
export function randInt(min: number, max: number, next: Rand32 = cryptoRand32): number {
  return min + randBelow(max - min + 1, next);
}

/** in-place Fisher–Yates shuffle */
export function shuffle<T>(items: T[], next: Rand32 = cryptoRand32): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randBelow(i + 1, next);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** `count` distinct integers from [0, n), in random order */
export function sampleUnique(n: number, count: number, next: Rand32 = cryptoRand32): number[] {
  if (count > n) throw new RangeError(`can't pick ${count} different values from ${n}`);
  // dense: partial Fisher–Yates over the whole range; sparse: redraw on collision
  if (count * 2 >= n) {
    const all = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < count; i++) {
      const j = i + randBelow(n - i, next);
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, count);
  }
  const seen = new Set<number>();
  while (seen.size < count) seen.add(randBelow(n, next));
  return [...seen];
}

export const MAX_COUNT = 100_000;
export const MAX_DECIMALS = 6;

export interface NumberOptions {
  min: number;
  max: number;
  count: number;
  /** 0 for whole numbers */
  decimals: number;
  unique: boolean;
  sort: 'none' | 'asc' | 'desc';
}

/** the grid of possible values: integers lo..hi, each divided by `scale` */
export function numberGrid(min: number, max: number, decimals: number) {
  const scale = 10 ** decimals;
  // toFixed trims float noise such as 0.1 * 3 = 0.30000000000000004 before rounding inwards
  const lo = Math.ceil(+(Math.min(min, max) * scale).toFixed(6));
  const hi = Math.floor(+(Math.max(min, max) * scale).toFixed(6));
  return { scale, lo, hi, size: hi - lo + 1 };
}

/** checks the options and returns a friendly problem, or '' when they work */
export function checkNumbers(o: NumberOptions): string {
  if (!Number.isFinite(o.min) || !Number.isFinite(o.max)) return 'Enter a minimum and a maximum.';
  if (!Number.isInteger(o.decimals) || o.decimals < 0 || o.decimals > MAX_DECIMALS) return `Decimal places go from 0 to ${MAX_DECIMALS}.`;
  if (o.count < 1) return 'Pick at least one number.';
  if (!Number.isInteger(o.count)) return 'How many should be a whole number.';
  if (o.count > MAX_COUNT) return `That's a lot. The most at once is ${MAX_COUNT.toLocaleString('en-US')}.`;
  const g = numberGrid(o.min, o.max, o.decimals);
  if (!Number.isSafeInteger(g.lo) || !Number.isSafeInteger(g.hi) || !Number.isSafeInteger(g.size)) return 'That range is too large to pick from exactly. Try smaller numbers or fewer decimal places.';
  if (g.size < 1) return 'There are no numbers with that many decimal places between the minimum and maximum.';
  if (o.unique && o.count > g.size) return `There are only ${g.size.toLocaleString('en-US')} different values in that range, so you can't get ${o.count.toLocaleString('en-US')} without repeats.`;
  return '';
}

export function generateNumbers(o: NumberOptions, next: Rand32 = cryptoRand32): number[] {
  const problem = checkNumbers(o);
  if (problem) throw new RangeError(problem);
  const { scale, lo, size } = numberGrid(o.min, o.max, o.decimals);
  const picks = o.unique
    ? sampleUnique(size, o.count, next)
    : Array.from({ length: o.count }, () => randBelow(size, next));
  const values = picks.map((k) => (lo + k) / scale);
  if (o.sort === 'asc') values.sort((a, b) => a - b);
  if (o.sort === 'desc') values.sort((a, b) => b - a);
  return values;
}

/** non-empty, trimmed lines */
export const listItems = (text: string) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** `count` is clamped to 1..MAX_COUNT so a huge number typed in can't freeze the page */
export function pickFromList<T>(items: T[], count: number, unique: boolean, next: Rand32 = cryptoRand32): T[] {
  if (!items.length) return [];
  count = Math.min(MAX_COUNT, Math.max(1, Math.floor(count) || 1));
  const picks = unique
    ? sampleUnique(items.length, Math.min(count, items.length), next)
    : Array.from({ length: count }, () => randBelow(items.length, next));
  return picks.map((i) => items[i]);
}

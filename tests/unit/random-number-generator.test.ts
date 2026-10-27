import { describe, expect, it } from 'vitest';
import { checkNumbers, generateNumbers, listItems, numberGrid, pickFromList, randBelow, randInt, sampleUnique, shuffle, type NumberOptions, type Rand32 } from '@/tools/lib/random/rng';

/** replays fixed 32-bit values */
const seq = (...values: number[]): Rand32 => {
  let i = 0;
  return () => values[i++ % values.length];
};

const opts = (o: Partial<NumberOptions>): NumberOptions => ({ min: 1, max: 10, count: 1, decimals: 0, unique: false, sort: 'none', ...o });

describe('randBelow', () => {
  it('rejects draws from the uneven tail instead of wrapping them', () => {
    // 2^32 % 3 = 1, so the very top value would favour 0 and must be redrawn
    expect(randBelow(3, seq(2 ** 32 - 1, 5))).toBe(2);
    expect(randBelow(3, seq(2 ** 32 - 2))).toBe((2 ** 32 - 2) % 3);
  });

  it('handles ranges wider than 32 bits', () => {
    const n = 2 ** 40 + 7;
    for (let i = 0; i < 200; i++) {
      const x = randBelow(n);
      expect(Number.isInteger(x) && x >= 0 && x < n).toBe(true);
    }
  });

  it('is roughly uniform', () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60_000; i++) counts[randBelow(6)]++;
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(600);
  });

  it('refuses nonsense', () => {
    expect(() => randBelow(0)).toThrow();
    expect(() => randBelow(1.5)).toThrow();
  });
});

describe('randInt', () => {
  it('stays inside an inclusive range, negatives too', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(randInt(-2, 2));
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
  });
});

describe('sampleUnique and shuffle', () => {
  it('never repeats, sparse or dense', () => {
    for (const [n, k] of [[1000, 10], [10, 10], [50, 30]]) {
      const s = sampleUnique(n, k);
      expect(s).toHaveLength(k);
      expect(new Set(s).size).toBe(k);
      expect(s.every((x) => x >= 0 && x < n)).toBe(true);
    }
    expect(() => sampleUnique(3, 4)).toThrow();
  });

  it('keeps every item when shuffling', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect([...shuffle([...items])].sort((a, b) => a - b)).toEqual(items);
  });
});

describe('generateNumbers', () => {
  it('makes unique, sorted whole numbers', () => {
    const v = generateNumbers(opts({ min: 1, max: 20, count: 20, unique: true, sort: 'asc' }));
    expect(v).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('sorts high to low', () => {
    const v = generateNumbers(opts({ min: 1, max: 1000, count: 50, sort: 'desc' }));
    expect(v).toEqual([...v].sort((a, b) => b - a));
  });

  it('respects decimal places and bounds', () => {
    const v = generateNumbers(opts({ min: 0.1, max: 0.3, count: 500, decimals: 1 }));
    expect(new Set(v)).toEqual(new Set([0.1, 0.2, 0.3]));
  });

  it('rounds a range inwards to the decimal grid', () => {
    expect(numberGrid(0.15, 0.45, 1)).toMatchObject({ lo: 2, hi: 4, size: 3 });
    expect(numberGrid(-0.15, 0.15, 1)).toMatchObject({ lo: -1, hi: 1, size: 3 });
    expect(numberGrid(10, 1, 0)).toMatchObject({ lo: 1, hi: 10 });
  });

  it('explains impossible requests', () => {
    expect(checkNumbers(opts({ min: 1, max: 5, count: 6, unique: true }))).toMatch(/only 5 different/);
    expect(checkNumbers(opts({ min: 0.11, max: 0.19, decimals: 1 }))).toMatch(/no numbers/);
    expect(checkNumbers(opts({ max: 2 ** 60 }))).toMatch(/too large/);
    expect(checkNumbers(opts({ count: 0 }))).toBeTruthy();
    expect(checkNumbers(opts({}))).toBe('');
    expect(() => generateNumbers(opts({ count: 0 }))).toThrow();
  });
});

describe('lists', () => {
  it('trims lines and drops blanks', () => {
    expect(listItems(' a \n\n b\r\nc ')).toEqual(['a', 'b', 'c']);
  });

  it('picks without repeats and caps at the list size', () => {
    const items = ['a', 'b', 'c'];
    const p = pickFromList(items, 5, true);
    expect(p).toHaveLength(3);
    expect(new Set(p).size).toBe(3);
    expect(pickFromList(items, 5, false)).toHaveLength(5);
    expect(pickFromList([], 2, true)).toEqual([]);
  });

  it('clamps an absurd count instead of freezing', () => {
    expect(pickFromList(['a'], 1e12, false)).toHaveLength(100_000);
    expect(pickFromList(['a', 'b'], 0, false)).toHaveLength(1);
  });

  it('explains a fractional count', () => {
    expect(checkNumbers({ min: 1, max: 10, count: 2.5, decimals: 0, unique: false, sort: 'none' })).toMatch(/whole number/);
  });
});

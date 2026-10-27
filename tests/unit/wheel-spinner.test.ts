import { describe, expect, it } from 'vitest';
import { indexAt, landingRotation, layout, parseEntries, pickWeighted, removeLine, sliceColors, spinEase } from '@/tools/lib/random/wheel';
import type { Rand32 } from '@/tools/lib/random/rng';

const fixed = (v: number): Rand32 => () => v;

describe('parseEntries', () => {
  it('reads names and optional weights', () => {
    expect(parseEntries('Alice\n\n  Bob *3 \nCara*0.5\nDan *0\n*2')).toEqual([
      { label: 'Alice', weight: 1, line: 0 },
      { label: 'Bob', weight: 3, line: 2 },
      { label: 'Cara', weight: 0.5, line: 3 },
      { label: '*2', weight: 1, line: 5 },
    ]);
  });

  it('keeps tiny positive weights on the wheel', () => {
    expect(parseEntries('x *0.001')[0].weight).toBe(0.01);
  });

  it('caps huge weights', () => {
    expect(parseEntries('x *99999')[0].weight).toBe(1000);
  });

  it('removes exactly one line', () => {
    expect(removeLine('a\nb\nc', 1)).toBe('a\nc');
  });
});

describe('pickWeighted', () => {
  it('maps the random draw onto weights', () => {
    // weights 1 and 3 become 100 and 300 ticks out of 400
    expect(pickWeighted([1, 3], fixed(99))).toBe(0);
    expect(pickWeighted([1, 3], fixed(100))).toBe(1);
    expect(pickWeighted([1, 3], fixed(399))).toBe(1);
  });

  it('follows the weights over many spins', () => {
    const counts = [0, 0];
    for (let i = 0; i < 40_000; i++) counts[pickWeighted([1, 3])]++;
    expect(counts[1] / counts[0]).toBeGreaterThan(2.7);
    expect(counts[1] / counts[0]).toBeLessThan(3.3);
  });
});

describe('wheel geometry', () => {
  const segs = layout([1, 2, 1]);

  it('sizes slices by weight', () => {
    expect(segs).toEqual([{ start: 0, end: 0.25 }, { start: 0.25, end: 0.75 }, { start: 0.75, end: 1 }]);
  });

  it('lands the pointer inside the chosen slice, after full turns', () => {
    for (const current of [0, 0.3, 7.91, -2.2]) {
      for (let i = 0; i < segs.length; i++) {
        for (const fraction of [0.15, 0.5, 0.85]) {
          const r = landingRotation(current, segs[i], 5, fraction);
          expect(r - current).toBeGreaterThanOrEqual(5);
          expect(r - current).toBeLessThan(6);
          expect(indexAt(r, segs)).toBe(i);
        }
      }
    }
  });

  it('eases out monotonically from 0 to 1', () => {
    expect(spinEase(0)).toBe(0);
    expect(spinEase(1)).toBe(1);
    let last = 0;
    for (let t = 0.01; t <= 1; t += 0.01) {
      expect(spinEase(t)).toBeGreaterThanOrEqual(last);
      last = spinEase(t);
    }
  });

  it('never gives neighbouring slices the same color', () => {
    for (const n of [2, 3, 7, 10, 11, 21, 31]) {
      const c = sliceColors(n, 10);
      for (let i = 0; i < n; i++) expect(c[i]).not.toBe(c[(i + 1) % n]);
    }
  });
});

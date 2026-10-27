import { describe, expect, it } from 'vitest';
import { PAPERS, cutLines, layoutSheet } from '../../src/tools/lib/passport/sheet';
import { SPECS, formatLength, guideFor, mmToPx, sizeLabel } from '../../src/tools/lib/passport/specs';
import { backgroundHints, backgroundStats, coversFrame } from '../../src/tools/lib/passport/check';
import { setDpi } from '../../src/tools/lib/passport/dpi';

const paper = (id: string) => PAPERS.find((p) => p.id === id)!;
const spec = (id: string) => SPECS.find((s) => s.id === id)!;

describe('layoutSheet', () => {
  it('fits six 2×2 in photos edge to edge on a 4×6 print', () => {
    const l = layoutSheet(paper('4x6'), 600, 600);
    expect([l.width, l.height]).toEqual([1200, 1800]);
    expect([l.cols, l.rows, l.gap]).toEqual([2, 3, 0]);
    expect(l.slots[0]).toEqual({ x: 0, y: 0 });
    expect(l.slots[5]).toEqual({ x: 600, y: 1200 });
  });

  it('fits eight 35×45 mm photos on a 4×6 print and keeps a cutting gap', () => {
    const g = guideFor(spec('uk'));
    expect([g.width, g.height]).toEqual([413, 531]);
    const l = layoutSheet(paper('4x6'), g.width, g.height);
    expect(l.slots).toHaveLength(8);
    expect(l.gap).toBe(mmToPx(2));
    expect([l.cols, l.rows]).toEqual([4, 2]);
  });

  it('centres the grid and keeps every photo inside the paper margin', () => {
    for (const p of PAPERS) {
      for (const s of SPECS) {
        const { width: w, height: h } = guideFor(s);
        const l = layoutSheet(p, w, h);
        const margin = mmToPx(p.marginMm);
        expect(l.slots.length).toBeGreaterThan(0);
        for (const { x, y } of l.slots) {
          expect(x).toBeGreaterThanOrEqual(margin);
          expect(y).toBeGreaterThanOrEqual(margin);
          expect(x + w).toBeLessThanOrEqual(l.width - margin);
          expect(y + h).toBeLessThanOrEqual(l.height - margin);
        }
        const left = l.slots[0].x;
        const right = l.width - (l.slots.at(-1)!.x + w);
        expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never overlaps photos', () => {
    const l = layoutSheet(paper('a4'), 591, 827);
    for (const a of l.slots) for (const b of l.slots) {
      if (a === b) continue;
      expect(a.x + 591 <= b.x || b.x + 591 <= a.x || a.y + 827 <= b.y || b.y + 827 <= a.y).toBe(true);
    }
  });

  it('uses the standard 300 dpi page sizes', () => {
    expect(layoutSheet(paper('a4'), 600, 600)).toMatchObject({ width: 2480, height: 3508, cols: 3, rows: 5 });
    expect(layoutSheet(paper('letter'), 600, 600)).toMatchObject({ width: 2550, height: 3300, cols: 4, rows: 5 });
  });

  it('lists each cut line once', () => {
    const l = layoutSheet(paper('4x6'), 600, 600);
    expect(cutLines(l, 600, 600)).toEqual({ xs: [0, 600, 1200], ys: [0, 600, 1200, 1800] });
  });
});

describe('specs', () => {
  it('matches the US rule: 600 px square, eyes 1⅛–1⅜ in from the bottom', () => {
    const g = guideFor(spec('us'));
    expect([g.width, g.height]).toEqual([600, 600]);
    expect(g.eyes[0]).toBeCloseTo(600 - 1.375 * 300);
    expect(g.eyes[1]).toBeCloseTo(600 - 1.125 * 300);
    expect(g.chin[1] - g.chin[0]).toBeCloseTo(0.375 * 300);
  });

  it('places every guide inside the frame with the eyes inside the head', () => {
    for (const s of SPECS) {
      const g = guideFor(s);
      expect(g.crown[0]).toBeGreaterThan(0);
      expect(g.chin[1]).toBeLessThan(g.height);
      expect(g.eyes[0]).toBeGreaterThan(g.crown[1]);
      expect(g.eyes[1]).toBeLessThan(g.chin[0]);
    }
  });

  it('formats sizes the way the rules print them', () => {
    expect(formatLength(1.375 * 25.4, 'in')).toBe('1⅜ in');
    expect(formatLength(0.5 * 25.4, 'in')).toBe('½ in');
    expect(sizeLabel(spec('us'))).toBe('2 × 2 in');
    expect(sizeLabel(spec('china'))).toBe('33 × 48 mm');
  });
});

describe('checks', () => {
  it('knows when the photo leaves a blank edge', () => {
    const frame = { width: 600, height: 600 };
    const img = { width: 1000, height: 1000 };
    expect(coversFrame({ cx: 300, cy: 300, scale: 0.6, rotation: 0 }, img, frame)).toBe(true);
    expect(coversFrame({ cx: 320, cy: 300, scale: 0.6, rotation: 0 }, img, frame)).toBe(false);
    expect(coversFrame({ cx: 300, cy: 300, scale: 0.6, rotation: 10 }, img, frame)).toBe(false);
    expect(coversFrame({ cx: 300, cy: 300, scale: 0.8, rotation: 10 }, img, frame)).toBe(true);
  });

  it('reads a background from the top corners', () => {
    const w = 100, h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) data.set([245, 245, 245, 255], i);
    // a dark "head" in the middle must not affect the reading
    for (let y = 0; y < 60; y++) for (let x = 30; x < 70; x++) data.set([20, 20, 20, 255], (y * w + x) * 4);
    const s = backgroundStats(data, w, h);
    expect(s.brightness).toBeCloseTo(245 / 255);
    expect(s.unevenness).toBeCloseTo(0);
    expect(backgroundHints(s, 'white')).toEqual([{ ok: true, text: expect.any(String) }]);
    expect(backgroundHints({ brightness: 0.5, unevenness: 0.2, tint: 0 }, 'white').filter((x) => !x.ok)).toHaveLength(2);
  });
});

describe('setDpi', () => {
  it('rewrites the JFIF density', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    const out = setDpi(jpg, 300);
    expect([...out.subarray(13, 18)]).toEqual([1, 1, 44, 1, 44]);
    expect(out.length).toBe(jpg.length);
  });

  it('adds a JFIF header when there is none', () => {
    const out = setDpi(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 2, 0xff, 0xd9]), 300);
    expect([...out.subarray(2, 4)]).toEqual([0xff, 0xe0]);
    expect([...out.subarray(13, 18)]).toEqual([1, 1, 44, 1, 44]);
    expect([...out.subarray(-4)]).toEqual([0, 2, 0xff, 0xd9]);
  });

  it('puts one pHYs chunk after IHDR in a PNG', () => {
    const chunk = (type: string, len: number) => [0, 0, 0, len, ...[...type].map((c) => c.charCodeAt(0)), ...new Array(len + 4).fill(0)];
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...chunk('IHDR', 13), ...chunk('pHYs', 9), ...chunk('IEND', 0)]);
    const out = setDpi(png, 300);
    const text = String.fromCharCode(...out);
    expect(text.indexOf('pHYs')).toBe(8 + 25 + 4);
    expect(text.split('pHYs')).toHaveLength(2);
    // 300 dpi = 11811 pixels per metre, and the crc a decoder checks
    expect(new DataView(out.buffer).getUint32(8 + 25 + 8)).toBe(11811);
    expect(new DataView(out.buffer).getUint32(8 + 25 + 17)).toBe(0x78a53f76);
  });
});

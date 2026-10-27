import { describe, expect, it } from 'vitest';
import tool from '@/tools/defs/object-remover';
import { cropAround, groupStrokes, near, shiftStrokes, strokeBounds, type Stroke } from '@/tools/lib/object-remover/geometry';
import { blend, boxBlur, cropPixels, fromPlanar, pastePixels, toPlanar } from '@/tools/lib/object-remover/pixels';

const paint = (r: number, ...pts: [number, number][]): Stroke => ({ erase: false, r, points: pts.map(([x, y]) => ({ x, y })) });
const erase = (r: number, ...pts: [number, number][]): Stroke => ({ ...paint(r, ...pts), erase: true });

function image(width: number, height: number, fill: (i: number) => number) {
  return { width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => fill(i)) };
}

describe('geometry', () => {
  it('bounds a stroke including its radius', () => {
    expect(strokeBounds(paint(5, [10, 20], [30, 25]))).toEqual({ x: 5, y: 15, w: 30, h: 15 });
  });

  it('bounds a very long stroke without running out of call arguments', () => {
    const points = Array.from({ length: 300_000 }, (_, i) => ({ x: i % 1000, y: i / 1000 }));
    expect(strokeBounds({ erase: false, r: 1, points })).toEqual({ x: -1, y: -1, w: 1001, h: 299.999 + 2 });
  });

  it('keeps far-apart marks as separate areas and joins close ones', () => {
    const a = paint(5, [10, 10]);
    const b = paint(5, [20, 10]);
    const c = paint(5, [500, 500]);
    const groups = groupStrokes([a, b, c], 10);
    expect(groups).toHaveLength(2);
    expect(groups[0].strokes).toEqual([a, b]);
    expect(groups[1].strokes).toEqual([c]);
  });

  it('joins areas transitively once their bounds grow', () => {
    const groups = groupStrokes([paint(5, [0, 0]), paint(5, [100, 0]), paint(5, [50, 0], [50, 1])], 50);
    expect(groups).toHaveLength(1);
  });

  it('gives each area the erase strokes that touch it, in drawing order', () => {
    const a = paint(5, [10, 10]);
    const e = erase(3, [12, 10]);
    const far = erase(3, [900, 900]);
    const [g] = groupStrokes([a, e, far], 10);
    expect(g.strokes).toEqual([a, e]);
    expect(groupStrokes([e], 10)).toEqual([]);
  });

  it('crops at least the model size around small marks, inside the image', () => {
    expect(cropAround({ x: 10, y: 10, w: 20, h: 20 }, 2000, 1500, 512)).toEqual({ x: 0, y: 0, w: 512, h: 512 });
    expect(cropAround({ x: 1990, y: 1490, w: 5, h: 5 }, 2000, 1500, 512)).toEqual({ x: 1488, y: 988, w: 512, h: 512 });
    const big = cropAround({ x: 500, y: 400, w: 600, h: 300 }, 2000, 1500, 512);
    expect(big.w).toBe(1028);
    expect(near(big, { x: 500, y: 400, w: 600, h: 300 })).toBe(true);
    expect(big.x).toBeLessThanOrEqual(500);
    expect(big.x + big.w).toBeGreaterThanOrEqual(1100);
  });

  it('never crops past a small image', () => {
    expect(cropAround({ x: 50, y: 50, w: 10, h: 10 }, 300, 200, 512)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });

  it('shifts strokes without touching the originals', () => {
    const s = paint(2, [5, 5]);
    expect(shiftStrokes([s], -5, 1)[0].points).toEqual([{ x: 0, y: 6 }]);
    expect(s.points).toEqual([{ x: 5, y: 5 }]);
  });
});

describe('pixels', () => {
  it('crops and pastes rows exactly', () => {
    const src = image(4, 3, (i) => i);
    const part = cropPixels(src, { x: 1, y: 1, w: 2, h: 2 });
    expect([...part.slice(0, 4)]).toEqual([20, 21, 22, 23]);
    const dst = image(4, 3, () => 0);
    pastePixels(dst, { data: part, width: 2, height: 2 }, 1, 1);
    expect([...cropPixels(dst, { x: 1, y: 1, w: 2, h: 2 })]).toEqual([...part]);
    expect(dst.data[0]).toBe(0);
  });

  it('box blur keeps far pixels at zero and full areas at 255', () => {
    const w = 20;
    const mask = new Uint8Array(w * w);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * w + x] = 255;
    const out = boxBlur(mask, w, w, 2);
    expect(out[0]).toBe(0);
    expect(out[10 * w + 10]).toBe(255);
    expect(out[10 * w + 4]).toBeGreaterThan(0);
    expect(out[10 * w + 2]).toBe(0);
  });

  it('blend leaves every unmarked pixel identical and keeps alpha', () => {
    const orig = image(3, 1, (i) => (i % 4 === 3 ? 200 : 10 + i));
    const fill = image(3, 1, () => 250);
    const out = blend(orig, fill, Uint8Array.from([0, 255, 128]));
    expect([...out.slice(0, 4)]).toEqual([...orig.data.slice(0, 4)]);
    expect([...out.slice(4, 8)]).toEqual([250, 250, 250, 200]);
    expect(out[8]).toBe(Math.round(18 + (232 * 128) / 255));
    expect(out[11]).toBe(200);
  });

  it('converts RGBA to planar RGB and back', () => {
    const rgba = Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 255]);
    const planar = toPlanar(rgba, new Float32Array(6), 1 / 255);
    expect(planar[1] * 255).toBeCloseTo(4);
    expect(planar[2] * 255).toBeCloseTo(2);
    expect([...fromPlanar(toPlanar(rgba, new Uint8Array(6)), 2)]).toEqual([...rgba]);
    expect([...fromPlanar([300, -5, 0, 0, 0, 0], 2).slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });
});

describe('object-remover page', () => {
  it('fits the SEO limits', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
    expect(tool.steps).toHaveLength(3);
  });
});

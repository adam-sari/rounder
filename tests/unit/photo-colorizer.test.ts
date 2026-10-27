import { describe, expect, it } from 'vitest';
import tool from '../../src/tools/defs/photo-colorizer';
import { bilinearAxis, composeColor, isOpaque, labToRgb, lightness, modelInput, rgbToLab } from '../../src/tools/lib/photo-colorizer/lab';

const px = (rgba: number[], width: number, height = 1) => ({ data: new Uint8ClampedArray(rgba), width, height });

describe('Lab conversion (OpenCV float convention)', () => {
  it('matches known values', () => {
    const near = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 1));
    near(rgbToLab(1, 1, 1), [100, 0, 0]);
    near(rgbToLab(0, 0, 0), [0, 0, 0]);
    near(rgbToLab(1, 0, 0), [53.24, 80.09, 67.2]);
    near(rgbToLab(0, 1, 0), [87.73, -86.18, 83.18]);
    near(rgbToLab(0, 0, 1), [32.3, 79.19, -107.86]);
  });

  it('round-trips colors', () => {
    for (const rgb of [[0.2, 0.5, 0.8], [0.9, 0.1, 0.3], [0.5, 0.5, 0.5], [0.02, 0.01, 0.03]] as [number, number, number][]) {
      labToRgb(...rgbToLab(...rgb)).forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 4));
    }
  });

  it('clips colors outside sRGB', () => {
    for (const v of labToRgb(50, 200, -200)) expect(v >= 0 && v <= 1).toBe(true);
  });

  it('reads the lightness of 8-bit pixels', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255, 255, 0, 0, 255]);
    expect(lightness(data, 0)).toBeCloseTo(rgbToLab(128 / 255, 128 / 255, 128 / 255)[0], 4);
    expect(lightness(data, 4)).toBeCloseTo(53.24, 1);
  });
});

describe('model input', () => {
  it('is grey, planar and keeps the lightness', () => {
    const out = modelInput(px([255, 0, 0, 255, 40, 40, 40, 255], 2));
    expect(out).toHaveLength(6);
    // red becomes the grey of the same lightness
    expect(out[0]).toBeCloseTo(out[2], 3);
    expect(out[0]).toBeCloseTo(out[4], 3);
    expect(rgbToLab(out[0], out[2], out[4])[0]).toBeCloseTo(53.24, 1);
    // a grey pixel goes in unchanged
    expect(out[1] * 255).toBeCloseTo(40, 1);
  });
});

describe('bilinear axis', () => {
  it('uses half-pixel centres like cv2.resize', () => {
    const { i0, i1, w } = bilinearAxis(2, 4);
    expect([...i0]).toEqual([0, 0, 0, 1]);
    expect([...i1]).toEqual([1, 1, 1, 1]);
    expect([...w]).toEqual([0, 0.25, 0.75, 0]);
  });

  it('maps a same-size axis onto itself', () => {
    const { i0, w } = bilinearAxis(5, 5);
    expect([...i0]).toEqual([0, 1, 2, 3, 4]);
    expect([...w].every((v) => v === 0)).toBe(true);
  });
});

describe('composeColor', () => {
  // 2 × 2 chroma planes: a then b
  const ab = (a: number, b: number) => new Float32Array([a, a, a, a, b, b, b, b]);

  it('keeps grey with zero chroma and the source alpha', () => {
    const out = composeColor(px([90, 90, 90, 255, 200, 200, 200, 128], 2), ab(0, 0), 1, 2);
    expect([...out]).toEqual([90, 90, 90, 255, 200, 200, 200, 128]);
  });

  it('adds the predicted color on top of the original lightness', () => {
    const [, a, b] = rgbToLab(0.8, 0.3, 0.2);
    const l = rgbToLab(0.8, 0.3, 0.2)[0];
    const grey = Math.round(labToRgb(l, 0, 0)[0] * 255);
    const out = composeColor(px([grey, grey, grey, 255], 1), ab(a, b), 1, 2);
    expect(out[0]).toBeCloseTo(204, -1);
    expect(out[1]).toBeCloseTo(77, -1);
    expect(out[2]).toBeCloseTo(51, -1);
  });

  it('scales the color with saturation', () => {
    const src = px([120, 120, 120, 255], 1);
    const spread = (o: Uint8ClampedArray) => Math.max(o[0], o[1], o[2]) - Math.min(o[0], o[1], o[2]);
    const half = composeColor(src, ab(30, 20), 0.5, 2);
    const full = composeColor(src, ab(30, 20), 1, 2);
    const none = composeColor(src, ab(30, 20), 0, 2);
    expect(spread(none)).toBe(0);
    expect(spread(half)).toBeLessThan(spread(full));
  });
});

describe('isOpaque', () => {
  it('spots any see-through pixel', () => {
    expect(isOpaque(px([1, 2, 3, 255, 4, 5, 6, 255], 2))).toBe(true);
    expect(isOpaque(px([1, 2, 3, 255, 4, 5, 6, 0], 2))).toBe(false);
  });
});

describe('tool definition', () => {
  it('fits search limits', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.steps).toHaveLength(3);
  });
});

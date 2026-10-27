import { describe, expect, it } from 'vitest';
import { RETRO, applyPalette, autoPalette, downsample, grayPalette, gridHeight, hardAlpha, maxScale, nearest, usedColors, type Pixels } from '../../src/tools/lib/pixel';

function img(w: number, h: number, fn: (x: number, y: number) => number[]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}
const px = (p: Pixels, x: number, y: number) => Array.from(p.data.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 4));

describe('downsample', () => {
  it('averages each block of source pixels', () => {
    const src = img(4, 2, (x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(px(downsample(src, 2, 1), 0, 0)).toEqual([128, 128, 128, 255]);
  });

  it('ignores the color of transparent pixels', () => {
    const src = img(2, 1, (x) => (x ? [0, 0, 0, 0] : [255, 0, 0, 255]));
    expect(px(downsample(src, 1, 1), 0, 0)).toEqual([255, 0, 0, 128]);
  });

  it('keeps square cells', () => {
    expect(gridHeight(1600, 900, 64)).toBe(36);
  });
});

describe('palettes', () => {
  it('defines the classic retro palettes', () => {
    expect(RETRO.gameboy.colors).toHaveLength(4);
    expect(RETRO.pico8.colors).toHaveLength(16);
    expect(RETRO.cga.colors).toContainEqual([85, 255, 255]);
    expect(grayPalette(3)).toEqual([[0, 0, 0], [128, 128, 128], [255, 255, 255]]);
  });

  it('finds the closest color', () => {
    expect(nearest(RETRO.cga.colors, 250, 80, 240)).toBe(2);
    expect(nearest(RETRO.cga.colors, 20, 20, 20)).toBe(0);
  });

  it('builds an auto palette from opaque pixels only', () => {
    const src = img(8, 8, (x, y) => (y === 0 ? [0, 255, 0, 0] : x < 4 ? [250, 10, 10, 255] : [10, 10, 250, 255]));
    const pal = autoPalette(src, 4);
    expect(pal.length).toBeLessThanOrEqual(4);
    expect(pal.some(([r, g, b]) => g > 200 && r < 50 && b < 50)).toBe(false);
  });
});

describe('applyPalette', () => {
  const gradient = img(64, 4, (x) => [x * 4, x * 4, x * 4, 255]);
  const bw = grayPalette(2);
  // how many of the darker half's pixels came out white
  const whitesInDarkHalf = (p: Pixels) => Array.from({ length: 32 }, (_, x) => px(p, x, 0)[0]).filter((v) => v === 255).length;

  it('maps every pixel into the palette', () => {
    for (const dither of ['none', 'bayer', 'floyd'] as const) {
      const out = applyPalette(gradient, bw, dither);
      expect(usedColors(out).every(([r]) => r === 0 || r === 255)).toBe(true);
    }
  });

  it('keeps tones with dithering and bands without it', () => {
    expect(whitesInDarkHalf(applyPalette(gradient, bw, 'none'))).toBe(0);
    expect(whitesInDarkHalf(applyPalette(gradient, bw, 'bayer'))).toBeGreaterThan(4);
    expect(whitesInDarkHalf(applyPalette(gradient, bw, 'floyd'))).toBeGreaterThan(4);
  });

  it('makes alpha crisp', () => {
    const src = img(2, 1, (x) => (x ? [200, 200, 200, 100] : [200, 200, 200, 200]));
    const out = applyPalette(src, bw);
    expect(px(out, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(out, 1, 0)[3]).toBe(0);
    expect(px(hardAlpha(src), 1, 0)).toEqual([200, 200, 200, 0]);
  });
});

describe('maxScale', () => {
  it('keeps the chosen upscale when it fits', () => {
    expect(maxScale(64, 48, 16)).toBe(16);
    expect(maxScale(256, 256, 16)).toBe(16);
  });

  it('caps tall grids and huge "original size" upscales to what a canvas can hold', () => {
    expect(maxScale(256, 2560, 16)).toBe(5);
    expect(maxScale(16, 11, 750)).toBe(308);
    expect(maxScale(10, 10, 0)).toBe(1);
  });
});

describe('ordered dithering', () => {
  it('gives the same answer for a color whichever pixel meets it first', () => {
    const flat = img(8, 8, () => [128, 128, 128, 255]);
    const a = applyPalette(flat, RETRO.cga.colors, 'bayer');
    const b = applyPalette(img(8, 8, (x, y) => (x + y ? [128, 128, 128, 255] : [255, 255, 255, 255])), RETRO.cga.colors, 'bayer');
    expect(px(a, 3, 3)).toEqual(px(b, 3, 3));
  });
});

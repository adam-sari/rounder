import { describe, expect, it } from 'vitest';
import { formatMB } from '../../src/engines/ai/progress';
import { MODELS, totalDownloadSize } from '../../src/engines/ai/models';
import tool from '../../src/tools/defs/image-upscaler';
import {
  axisStarts,
  blendTile,
  copyAlpha,
  crop,
  estimateSeconds,
  fitWithin,
  formatDuration,
  fromReconstruction,
  hasTransparency,
  maxInputSide,
  planTiles,
  tiling,
  toPixelValues,
  type Pixels,
} from '../../src/tools/lib/image-upscaler/tiles';

const solid = (width: number, height: number, rgba: number[]): Pixels => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, width, height };
};

describe('tile plan', () => {
  it('covers each side with equal tiles, the last one flush with the edge', () => {
    expect(axisStarts(100, 128, 16)).toEqual([0]);
    expect(axisStarts(128, 128, 16)).toEqual([0]);
    expect(axisStarts(300, 128, 16)).toEqual([0, 112, 172]);
    for (const len of [129, 250, 1000, 1501]) {
      const starts = axisStarts(len, 128, 16);
      expect(starts.at(-1)! + 128).toBe(len);
      // neighbours always overlap by at least the requested amount
      starts.slice(1).forEach((s, i) => expect(starts[i] + 128 - s).toBeGreaterThanOrEqual(16));
    }
  });

  it('lists tiles row by row with their overlaps', () => {
    const tiles = planTiles(300, 100, 128, 16);
    expect(tiles).toEqual([
      { x: 0, y: 0, w: 128, h: 100, left: 0, top: 0 },
      { x: 112, y: 0, w: 128, h: 100, left: 16, top: 0 },
      { x: 172, y: 0, w: 128, h: 100, left: 68, top: 0 },
    ]);
    expect(planTiles(1000, 700, 256, 24)).toHaveLength(5 * 3);
  });
});

describe('model input and output', () => {
  it('pads to a multiple of 8 by repeating edge pixels, as planar RGB in 0–1', () => {
    const img = solid(3, 2, [255, 0, 51, 255]);
    img.data.set([0, 255, 0, 255], (1 * 3 + 2) * 4); // bottom-right pixel green
    const { values, width, height } = toPixelValues(img);
    expect([width, height]).toEqual([8, 8]);
    const plane = 64;
    expect(values[0]).toBe(1);
    expect(values[2 * plane]).toBeCloseTo(0.2);
    // padding copies the green corner to the right and down
    expect(values[7 * 8 + 7 + plane]).toBe(1);
    expect(values[1 * 8 + 7 + plane]).toBe(1);
    expect(values[0 * 8 + 7 + plane]).toBe(0);
  });

  it('crops the padding off the output and clamps values', () => {
    const pw = 4;
    const ph = 2;
    const values = new Float32Array(pw * ph * 3).fill(0.5);
    values[0] = 1.4;
    values[pw * ph] = -0.2;
    const out = fromReconstruction(values, pw, ph, 3, 2);
    expect([out.width, out.height]).toEqual([3, 2]);
    expect(Array.from(out.data.slice(0, 4))).toEqual([255, 0, 128, 255]);
  });

  it('crops a piece out of an image', () => {
    const img = solid(4, 4, [0, 0, 0, 255]);
    img.data.set([9, 9, 9, 255], (2 * 4 + 1) * 4);
    const piece = crop(img, 1, 2, 2, 2);
    expect(piece.width).toBe(2);
    expect(Array.from(piece.data.slice(0, 4))).toEqual([9, 9, 9, 255]);
  });
});

describe('blending', () => {
  it('fades from the earlier tile to the new one across the overlap', () => {
    const out = solid(12, 1, [0, 0, 0, 0]);
    blendTile(out, solid(8, 1, [0, 0, 0, 255]), 0, 0, 0, 0);
    blendTile(out, solid(8, 1, [200, 200, 200, 255]), 4, 0, 4, 0);
    const reds = Array.from({ length: 12 }, (_, x) => out.data[x * 4]);
    expect(reds.slice(0, 4)).toEqual([0, 0, 0, 0]);
    // the overlap rises steadily and lands on the new tile's value
    for (let x = 5; x < 8; x++) expect(reds[x]).toBeGreaterThan(reds[x - 1]);
    expect(reds[4]).toBeLessThan(50);
    expect(reds.slice(8)).toEqual([200, 200, 200, 200]);
  });

  it('leaves a uniform image seamless through a full tiled pass', () => {
    const tiles = planTiles(300, 260, 128, 16);
    const out = solid(600, 520, [0, 0, 0, 0]);
    for (const t of tiles) blendTile(out, solid(t.w * 2, t.h * 2, [90, 120, 150, 255]), t.x * 2, t.y * 2, t.left * 2, t.top * 2);
    const values = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) values.add(out.data[i] * 1e9 + out.data[i + 1] * 1e6 + out.data[i + 2] * 1e3 + out.data[i + 3]);
    expect([...values]).toEqual([90 * 1e9 + 120 * 1e6 + 150 * 1e3 + 255]);
  });

  it('finds and copies transparency', () => {
    const img = solid(2, 2, [1, 2, 3, 255]);
    expect(hasTransparency(img)).toBe(false);
    copyAlpha(img, solid(2, 2, [0, 0, 0, 40]));
    expect(hasTransparency(img)).toBe(true);
    expect(Array.from(img.data.slice(0, 4))).toEqual([1, 2, 3, 40]);
  });
});

describe('limits and estimates', () => {
  it('caps the result at 6000 px on computers and 4096 px on phones', () => {
    expect(maxInputSide(4, false)).toBe(1500);
    expect(maxInputSide(2, false)).toBe(3000);
    expect(maxInputSide(4, true)).toBe(1024);
    expect(fitWithin(4000, 3000, 1500)).toEqual({ width: 1500, height: 1125 });
    expect(fitWithin(800, 600, 1500)).toEqual({ width: 800, height: 600 });
  });

  it('estimates the CPU time from measured speeds', () => {
    // 1000 px at 4× on one CPU thread: 81 tiles of 128 px at ≈10.5 s each
    const tiles = planTiles(1000, 1000, 128, 16);
    expect(tiles).toHaveLength(81);
    expect(estimateSeconds(tiles, 'wasm', 4, false) / 60).toBeCloseTo(14, 0);
    expect(estimateSeconds(tiles, 'wasm', 2, false)).toBeLessThan(estimateSeconds(tiles, 'wasm', 4, false) / 4);
  });

  it('shrinks GPU tiles when the graphics card has small buffers', () => {
    expect(tiling('wasm', 4, 4 * 2 ** 30)).toEqual({ tile: 128, overlap: 16 });
    expect(tiling('webgpu', 4, 4 * 2 ** 30).tile).toBe(256);
    // a phone-class 256 MiB limit: the 4× feature map of a 256 px tile alone would fill it
    expect(tiling('webgpu', 4, 2 ** 28).tile).toBe(128);
    expect(tiling('webgpu', 2, 2 ** 28).tile).toBe(256);
  });

  it('describes durations in plain words', () => {
    expect(formatDuration(5)).toBe('a few seconds');
    expect(formatDuration(45)).toBe('under a minute');
    expect(formatDuration(200)).toBe('about 3 min');
    expect(formatDuration(4000)).toBe('about 1 h 7 min');
  });
});

describe('page copy', () => {
  it('fits search limits and ends with the privacy answer', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.faq.at(-1)?.q).toMatch(/uploaded/);
  });

  it('quotes the registry model sizes', () => {
    const answer = tool.faq.find((f) => /model/.test(f.q))!.a;
    const x4 = MODELS['swin2sr-x4-realworld'];
    for (const bytes of [MODELS['swin2sr-x2-light'].variants.fp32.files[0].bytes, x4.variants.fp32.files[0].bytes, x4.variants.q8.files[0].bytes]) {
      expect(answer).toContain(formatMB(bytes));
    }
    expect(totalDownloadSize('swin2sr-x4-realworld', 'q8')).toBeLessThan(20e6);
  });
});

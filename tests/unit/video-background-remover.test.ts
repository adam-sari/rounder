import { describe, expect, it } from 'vitest';
import tool from '../../src/tools/defs/video-background-remover';
import { coverRect, edgeRamp, exportSize, fitSize, MASK_LONG_SIDE, MASK_PAD, maskSize, smoothMask, writeAlpha } from '../../src/tools/lib/video-bg/matte';

describe('mask smoothing', () => {
  it('passes the new mask straight through with smoothing off', () => {
    const acc = new Float32Array([0.2, 0.9]);
    smoothMask(acc, new Float32Array([0.25, 0.1]), 0);
    expect([...acc].map((v) => +v.toFixed(3))).toEqual([0.25, 0.1]);
  });

  it('damps small flicker hard but follows big changes quickly', () => {
    const acc = new Float32Array([0.5, 0]);
    smoothMask(acc, new Float32Array([0.55, 1]), 1);
    // flicker of 0.05 moves only a little of the way
    expect(acc[0]).toBeGreaterThan(0.5);
    expect(acc[0]).toBeLessThan(0.515);
    // a person stepping in (0 → 1) is followed at once
    expect(acc[1]).toBe(1);
  });

  it('settles on a steady mask', () => {
    const acc = new Float32Array([0]);
    for (let i = 0; i < 60; i++) smoothMask(acc, new Float32Array([0.3]), 0.8);
    expect(acc[0]).toBeCloseTo(0.3, 2);
  });
});

describe('edge ramp', () => {
  it('is 0 well below and 255 well above the 0.5 threshold, and monotonic', () => {
    for (const f of [0, 0.5, 1]) {
      const lut = edgeRamp(f);
      expect(lut[0]).toBe(0);
      expect(lut[255]).toBe(255);
      expect(Math.abs(lut[128] - 128)).toBeLessThan(12);
      for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
  });

  it('gets softer with more feather', () => {
    expect(edgeRamp(1)[90]).toBeGreaterThan(edgeRamp(0)[90]);
  });
});

describe('writeAlpha', () => {
  it('writes alpha with the edges repeated into the padding', () => {
    const w = 2;
    const h = 1;
    const pw = w + 2 * MASK_PAD;
    const ph = h + 2 * MASK_PAD;
    const out = new Uint8ClampedArray(pw * ph * 4);
    writeAlpha(new Float32Array([0, 1]), w, h, edgeRamp(0), out);
    const a = (x: number, y: number) => out[(y * pw + x) * 4 + 3];
    expect(a(MASK_PAD, MASK_PAD)).toBe(0);
    expect(a(MASK_PAD + 1, MASK_PAD)).toBe(255);
    expect(a(0, 0)).toBe(0);
    expect(a(pw - 1, ph - 1)).toBe(255);
  });
});

describe('sizes', () => {
  it('keeps the frame aspect for the mask', () => {
    expect(maskSize(1920, 1080)).toEqual({ width: MASK_LONG_SIDE, height: 144 });
    expect(maskSize(1080, 1920)).toEqual({ width: 144, height: MASK_LONG_SIDE });
  });

  it('caps the short side of the export, evenly, and never upscales', () => {
    expect(exportSize(3840, 2160, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(exportSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(exportSize(1279, 719, 1080)).toEqual({ width: 1280, height: 720 });
    expect(exportSize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 });
  });

  it('fits the preview without upscaling', () => {
    expect(fitSize(1920, 1080, 960)).toEqual({ width: 960, height: 540 });
    expect(fitSize(640, 360, 960)).toEqual({ width: 640, height: 360 });
  });

  it('covers the frame with a background image, centred', () => {
    expect(coverRect(100, 100, 200, 100)).toEqual({ x: 0, y: -50, width: 200, height: 200 });
  });
});

describe('page', () => {
  it('fits search limits', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
    expect(tool.steps).toHaveLength(3);
    expect(tool.faq.at(-1)?.q).toMatch(/uploaded/);
  });
});

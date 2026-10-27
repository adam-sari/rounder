import { describe, expect, it } from 'vitest';
import tool from '../../src/tools/defs/depth-map-generator';
import { filePrivacyFaq } from '../../src/tools/types';
import { colorize, dilate, lut } from '../../src/tools/lib/depth-map/colormap';
import { cameraAt, cameraFrom, fitSize, frameDuration, MAX_SHIFT, MAX_ZOOM, MOTIONS, overscan } from '../../src/tools/lib/depth-map/motion';

describe('colormaps', () => {
  it('runs from dark to light at the documented end colors', () => {
    const at = (map: Parameters<typeof lut>[0], i: number) => Array.from(lut(map).slice(i * 3, i * 3 + 3));
    expect(at('gray', 0)).toEqual([0, 0, 0]);
    expect(at('gray', 255)).toEqual([255, 255, 255]);
    // matplotlib: viridis #440154 → #fde725, inferno #000004 → #fcffa4
    const near = (a: number[], b: number[]) => a.forEach((v, k) => expect(Math.abs(v - b[k])).toBeLessThanOrEqual(8));
    near(at('viridis', 0), [0x44, 0x01, 0x54]);
    near(at('viridis', 255), [0xfd, 0xe7, 0x25]);
    near(at('inferno', 0), [0, 0, 4]);
    near(at('inferno', 255), [0xfc, 0xff, 0xa4]);
    // turbo (polynomial fit): near-black blue → dark red
    near(at('turbo', 0), [35, 23, 27]);
    expect(at('turbo', 255)[0]).toBeGreaterThan(at('turbo', 255)[2] * 5);
  });

  it('colors each depth byte, optionally inverted', () => {
    const out = colorize(new Uint8Array([0, 255]), 'gray');
    expect(Array.from(out)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(Array.from(colorize(new Uint8Array([0]), 'gray', true))).toEqual([255, 255, 255, 255]);
  });

  it('grows near areas by the radius, in both directions', () => {
    const d = new Uint8Array(25);
    d[12] = 200; // centre of 5×5
    const out = dilate(d, 5, 5, 1);
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 0, 200, 200, 200, 0, 0, 200, 200, 200, 0, 0, 200, 200, 200, 0, 0, 0, 0, 0, 0]);
    expect(dilate(d, 5, 5, 0)).toBe(d);
  });
});

describe('camera paths', () => {
  it('loops seamlessly and starts the dolly at rest', () => {
    for (const [m] of MOTIONS) {
      const a = cameraAt(m, 0, 0.7);
      const b = cameraAt(m, 1, 0.7);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
      expect(b.zoom).toBeCloseTo(a.zoom, 9);
    }
    expect(cameraAt('dolly', 0, 1).zoom).toBe(0);
    expect(cameraAt('dolly', 0.5, 1).zoom).toBeCloseTo(MAX_ZOOM);
  });

  it('caps pointer steering at the same reach as the loops', () => {
    expect(cameraFrom(1, 0, 1).x).toBeCloseTo(MAX_SHIFT);
    expect(Math.hypot(cameraFrom(1, 1, 1).x, cameraFrom(1, 1, 1).y)).toBeCloseTo(MAX_SHIFT);
  });

  it('scales the photo just enough that no sample falls off the edge', () => {
    // the shader: 0.5 + (s − 0.5 − shift·k) / (scale · (1 + zoom·k)), k = depth − focus
    for (const [m] of MOTIONS)
      for (const focus of [0, 0.3, 0.5, 1])
        for (const amount of [0.2, 1]) {
          const scale = overscan(m, amount, focus);
          let worst = 0;
          for (let t = 0; t < 1; t += 0.01)
            for (const d of [0, 1])
              for (const s of [0, 1]) {
                const cam = cameraAt(m, t, amount);
                const k = d - focus;
                const u = 0.5 + (s - 0.5 - cam.x * k) / (scale * (1 + cam.zoom * k));
                const v = 0.5 + (s - 0.5 - cam.y * k) / (scale * (1 + cam.zoom * k));
                worst = Math.max(worst, Math.abs(u - 0.5), Math.abs(v - 0.5));
              }
          expect(worst).toBeLessThanOrEqual(0.5 + 1e-9);
        }
    expect(overscan('orbit', 0, 0.5)).toBe(1);
  });
});

describe('export sizing', () => {
  it('fits the long side and keeps sides even', () => {
    expect(fitSize(4000, 3000, 1080)).toEqual({ width: 1080, height: 810 });
    expect(fitSize(1001, 667, 1080)).toEqual({ width: 1002, height: 668 });
    expect(fitSize(3, 3, 480).width % 2).toBe(0);
  });

  it('gives each still exactly one frame in the slideshow encoder', () => {
    // mirrors imagesToVideo's slot logic in src/engines/media/core.ts
    for (const fps of [15, 24, 25, 30])
      for (let n = 1; n <= 240; n++) {
        const durs = Array<number>(n).fill(frameDuration(fps));
        const frames = Math.max(1, Math.round(durs.reduce((a, b) => a + b, 0) * fps));
        expect(frames).toBe(n);
        let slot = 0;
        let start = 0;
        for (let i = 0; i < frames; i++) {
          while (slot < n - 1 && i / fps >= start + durs[slot]) start += durs[slot++];
          expect(slot).toBe(i);
        }
      }
  });
});

describe('page', () => {
  it('meets the copy rules', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
    expect(tool.steps).toHaveLength(3);
    expect(tool.faq.at(-1)).toBe(filePrivacyFaq);
    expect(tool.faq.some((f) => /Apache-2\.0/.test(f.a))).toBe(true);
  });
});

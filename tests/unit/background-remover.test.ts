import { describe, expect, it } from 'vitest';
import { alphaBounds, boxMean, downsample, fitSize, maskVerdict, padBox, refineMatte, resizeBilinear, segmentStamps, toProbabilities } from '../../src/tools/lib/background-remover/matte';

describe('resampling', () => {
  it('fits the longest side without enlarging', () => {
    expect(fitSize(4000, 3000, 1024)).toEqual([1024, 768]);
    expect(fitSize(800, 600, 1024)).toEqual([800, 600]);
  });

  it('averages blocks when downscaling', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255]);
    expect([...downsample(rgba, 2, 2, 1, 1, 4)]).toEqual([100, 100, 100, 255]);
    expect([...downsample(new Uint8Array([0, 255, 0, 255]), 4, 1, 2, 1, 1)]).toEqual([128, 128]);
  });

  it('keeps a constant image constant and interpolates between pixels', () => {
    expect([...resizeBilinear(new Float32Array(4).fill(0.5), 2, 2, 5, 3)].every((v) => v === 0.5)).toBe(true);
    const up = resizeBilinear(new Float32Array([0, 1]), 2, 1, 4, 1);
    expect([...up]).toEqual([0, 0.25, 0.75, 1]);
  });

  it('box mean shrinks its window at the borders', () => {
    expect([...boxMean(new Float32Array([0, 3, 6]), 3, 1, 1)]).toEqual([1.5, 3, 4.5]);
  });
});

describe('model output', () => {
  it('turns logits into probabilities but leaves probabilities alone', () => {
    expect([...toProbabilities(new Float32Array([0, 0.25, 1]))]).toEqual([0, 0.25, 1]);
    const p = toProbabilities(new Float32Array([-20, 0, 20]));
    expect(p[0]).toBeLessThan(1e-6);
    expect(p[1]).toBe(0.5);
    expect(p[2]).toBeGreaterThan(0.999);
  });
});

describe('maskVerdict', () => {
  const mask = (f: (i: number) => number) => Float32Array.from({ length: 10000 }, (_, i) => f(i));

  it('accepts a clear subject', () => {
    expect(maskVerdict(mask((i) => (i % 100 < 40 ? 1 : 0)))).toBe('ok');
  });

  it('rejects NaN, nothing, everything and noise', () => {
    expect(maskVerdict(mask((i) => (i === 5 ? NaN : 1)))).toBe('invalid');
    expect(maskVerdict(mask(() => 0.01))).toBe('empty');
    expect(maskVerdict(mask(() => 0.99))).toBe('everything');
    expect(maskVerdict(mask((i) => 0.3 + 0.4 * ((i * 7919) % 100) / 100))).toBe('noise');
  });
});

describe('refineMatte', () => {
  // a full-size photo: dark background, bright subject from x = 38, an edge inside a work pixel
  const W = 64;
  const H = 16;
  const full = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) full.fill(x < 38 ? 30 : 220, (y * W + x) * 4, (y * W + x) * 4 + 3);
  const work = downsample(full, W, H, 16, 4, 4);
  // the model's 16×4 mask: right place, but only work-pixel sharp
  const row = [0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.6, 1, 1, 1, 1, 1, 1];
  const coarse = new Float32Array([...row, ...row, ...row, ...row]);
  const crossing = (r: number[]) => r.findIndex((v) => v >= 128);

  it('snaps the upscaled edge to the full-size photo', () => {
    const out = [...refineMatte(coarse, 16, 4, work, 16, 4, full, W, H).slice(8 * W, 9 * W)];
    expect(crossing(out)).toBe(38);
    expect(out.slice(38).every((v) => v === 255)).toBe(true);
    expect(Math.max(...out.slice(0, 38))).toBeLessThan(40);
    // a plain bilinear upscale puts the edge in the wrong place and smears it
    const naive = [...resizeBilinear(coarse, 16, 4, W, H).slice(8 * W, 9 * W)].map((v) => Math.round(v * 255));
    expect(crossing(naive)).not.toBe(38);
  });

  it('keeps solid regions solid when the photo has texture', () => {
    const noisy = full.map((v, i) => (i % 4 === 3 ? v : v + ((i * 7919) % 11) - 5));
    const alpha = refineMatte(new Float32Array(8).fill(1), 4, 2, work, 16, 4, noisy, W, H);
    expect(alpha.every((v) => v === 255)).toBe(true);
  });
});

describe('crop and brush geometry', () => {
  it('finds the subject bounds in a mask or an RGBA readback', () => {
    const m = new Uint8Array(5 * 4);
    m[1 * 5 + 1] = 200;
    m[2 * 5 + 3] = 40;
    expect(alphaBounds(m, 5, 4)).toEqual({ x: 1, y: 1, w: 3, h: 2 });
    expect(alphaBounds(new Uint8Array(20), 5, 4)).toBeNull();
    const rgba = new Uint8Array(3 * 1 * 4);
    rgba[2 * 4 + 3] = 255;
    expect(alphaBounds(rgba, 3, 1, 4, 3)).toEqual({ x: 2, y: 0, w: 1, h: 1 });
  });

  it('pads a box but keeps it inside the image', () => {
    expect(padBox({ x: 10, y: 5, w: 20, h: 20 }, 8, 100, 28)).toEqual({ x: 2, y: 0, w: 36, h: 28 });
  });

  it('spaces brush dabs evenly and ends on the last point', () => {
    expect(segmentStamps(0, 0, 10, 0, 4)).toEqual([10 / 3, 0, 20 / 3, 0, 10, 0]);
    expect(segmentStamps(5, 5, 5, 5, 4)).toEqual([5, 5]);
  });
});

import { describe, expect, it } from 'vitest';
import { GIFEncoder } from 'gifenc';
import { decodeGifFrames, parseGif } from '@/engines/media/gif';
import { indexFrame } from '@/tools/lib/video-to-gif/palette';
import { friendlyError } from '@/tools/lib/video-to-gif/errors';
import {
  defaultWidth,
  estimateGifBytes,
  estimateVideoBytes,
  eta,
  formatDuration,
  frameTimes,
  gifDelays,
  gifRepeat,
  outputDuration,
  outputSize,
  widthRange,
} from '@/tools/lib/video-to-gif/plan';

/** a w×h frame: horizontal gradient with a square at (sx, sy) */
function frame(w: number, h: number, sx = -100, sy = -100) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const inSquare = x >= sx && x < sx + 8 && y >= sy && y < sy + 8;
      rgba.set(inSquare ? [255, 40, 40, 255] : [Math.round((x / (w - 1)) * 255), 90, 200, 255], o);
    }
  return rgba;
}

describe('frame timing', () => {
  it('samples one source time per output frame', () => {
    expect(frameTimes(0, 1, 10)).toHaveLength(10);
    expect(frameTimes(2, 3, 4)).toEqual([2, 2.25, 2.5, 2.75]);
    // 2× speed: half the frames, twice as far apart in the source
    expect(frameTimes(0, 1, 10, 2)).toHaveLength(5);
    expect(frameTimes(0, 1, 10, 2)[1]).toBeCloseTo(0.2);
    expect(frameTimes(0, 0.01, 12)).toHaveLength(1);
  });

  it('spreads centisecond rounding so the total length is exact', () => {
    const d = gifDelays(12, 12);
    expect(d.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(new Set(d)).toEqual(new Set([80, 90]));
    expect(gifDelays(3, 10)).toEqual([100, 100, 100]);
  });

  it('maps play counts to the NETSCAPE loop field', () => {
    expect(gifRepeat(0)).toBe(0);
    expect(gifRepeat(1)).toBe(-1);
    expect(gifRepeat(3)).toBe(2);
  });

  it('works out output length with speed', () => {
    expect(outputDuration(1, 5, 2)).toBe(2);
    expect(outputDuration(5, 1)).toBe(0);
  });
});

describe('sizing', () => {
  it('keeps the aspect ratio and never upscales', () => {
    expect(outputSize(1920, 1080, 480)).toEqual({ width: 480, height: 270 });
    expect(outputSize(320, 240, 800)).toEqual({ width: 320, height: 240 });
    expect(outputSize(1080, 1920, 481, true)).toEqual({ width: 482, height: 856 });
  });

  it('bounds the width slider by the source', () => {
    expect(widthRange(1920)).toEqual({ min: 240, max: 800 });
    expect(widthRange(160)).toEqual({ min: 160, max: 160 });
    expect(defaultWidth(1920)).toBe(480);
    expect(defaultWidth(300)).toBe(300);
  });
});

describe('estimates', () => {
  it('scales diff frames across the clip', () => {
    expect(estimateGifBytes(10, 1000, [200, 400])).toBe(1000 + 9 * 300);
    expect(estimateGifBytes(1, 1000, [200])).toBe(1000);
    expect(estimateGifBytes(3, 1000, [])).toBe(3000);
  });

  it('converts a bitrate to bytes', () => {
    expect(estimateVideoBytes(800_000, 10)).toBe(Math.round(1_000_000 * 1.03 + 2000));
  });

  it('only guesses the time left once there is something to go on', () => {
    expect(eta(0.01, 5000)).toBeNull();
    expect(eta(0.5, 1000)).toBeNull();
    expect(eta(0.5, 10_000)).toBe(10);
    expect(formatDuration(5.4)).toBe('5 s');
    expect(formatDuration(65)).toBe('1 min 05 s');
  });
});

describe('indexFrame', () => {
  const w = 32;
  const h = 24;

  it('stores the first frame in full within the palette size', () => {
    const screen = new Uint8Array(w * h * 3);
    const f = indexFrame(frame(w, h), w, h, screen, true, { colors: 32, dither: 'none' });
    expect(f.transparentIndex).toBe(-1);
    expect(f.palette.length).toBeLessThanOrEqual(32);
    expect(Math.max(...f.index)).toBeLessThan(f.palette.length);
    // the screen now holds palette colors close to the source
    expect(Math.abs(screen[0] - 0)).toBeLessThan(24);
    expect(Math.abs(screen[(w - 1) * 3] - 255)).toBeLessThan(24);
  });

  it('makes unchanged pixels transparent and only repaints what moved', () => {
    const screen = new Uint8Array(w * h * 3);
    indexFrame(frame(w, h, 2, 2), w, h, screen, true, { colors: 64, dither: 'none' });
    const same = indexFrame(frame(w, h, 2, 2), w, h, screen, false, { colors: 64, dither: 'none' });
    expect(same.index.every((i) => i === same.transparentIndex)).toBe(true);

    const moved = indexFrame(frame(w, h, 12, 10), w, h, screen, false, { colors: 64, dither: 'none' });
    const t = moved.transparentIndex;
    expect(t).toBe(moved.palette.length - 1);
    const repainted = moved.index.filter((i) => i !== t).length;
    expect(repainted).toBeGreaterThanOrEqual(64);
    expect(repainted).toBeLessThanOrEqual(128 + 16);
    // the new square is red on screen
    const o = (14 * w + 14) * 3;
    expect(screen[o]).toBeGreaterThan(200);
    expect(screen[o + 1]).toBeLessThan(80);
  });

  it('dithers differently per mode but stays within the palette', () => {
    const run = (dither: 'none' | 'pattern' | 'diffuse') => indexFrame(frame(w, h), w, h, new Uint8Array(w * h * 3), true, { colors: 4, dither });
    const none = run('none');
    const pattern = run('pattern');
    const diffuse = run('diffuse');
    for (const f of [none, pattern, diffuse]) expect(Math.max(...f.index)).toBeLessThan(f.palette.length);
    expect(pattern.index).not.toEqual(none.index);
    expect(diffuse.index).not.toEqual(none.index);
  });

  it('round-trips through gifenc into a GIF the engine decoder reads back', () => {
    const screen = new Uint8Array(w * h * 3);
    const gif = GIFEncoder();
    for (const [i, sx] of [2, 10, 18].entries()) {
      const f = indexFrame(frame(w, h, sx, 4), w, h, screen, i === 0, { colors: 64, dither: 'pattern' });
      gif.writeFrame(f.index, w, h, { palette: f.palette, delay: 100, repeat: 0, transparent: f.transparentIndex >= 0, transparentIndex: Math.max(0, f.transparentIndex), dispose: 1 });
    }
    gif.finish();
    const bytes = gif.bytes();
    expect(parseGif(bytes).frames).toHaveLength(3);
    const frames = [...decodeGifFrames(bytes)];
    // what the decoder composites equals the tracked screen
    const last = frames[2].rgba;
    let maxErr = 0;
    for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(last[p * 4 + c] - screen[p * 3 + c]));
    expect(maxErr).toBe(0);
  });
});

describe('friendlyError', () => {
  it('stays quiet for cancels and explains the rest', () => {
    expect(friendlyError({ code: 'aborted', message: 'Cancelled.' })).toBeNull();
    expect(friendlyError({ code: 'out-of-memory', message: 'x' })).toMatch(/shorter range/);
    expect(friendlyError({ code: 'failed', message: 'Disk full' })).toBe('Disk full');
    expect(friendlyError(undefined)).toMatch(/try again/);
  });
});

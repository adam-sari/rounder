import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { decodeGifFrames, isGif, parseGif } from '@/engines/media/gif';

const fixture = new Uint8Array(readFileSync('tests/fixtures/media/sample.gif'));

describe('GIF decoder', () => {
  it('parses the fixture header and frame table', () => {
    expect(isGif(fixture)).toBe(true);
    const gif = parseGif(fixture);
    expect([gif.width, gif.height]).toEqual([160, 90]);
    expect(gif.loop).toBe(0);
    expect(gif.frames).toHaveLength(20);
    expect(gif.frames.every((f) => f.delayMs === 100)).toBe(true);
  });

  it('decodes opaque, changing frames', () => {
    const frames = [...decodeGifFrames(fixture)];
    expect(frames).toHaveLength(20);
    for (const f of frames) expect(f.rgba.length).toBe(160 * 90 * 4);
    // fully painted (ffmpeg's palettegen output has no transparency)
    expect(frames[0].rgba.filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true);
    // testsrc2 animates, so consecutive frames differ
    const diff = frames[0].rgba.reduce((n, v, i) => n + (v !== frames[5].rgba[i] ? 1 : 0), 0);
    expect(diff).toBeGreaterThan(1000);
  });

  it('round-trips pixels written by gifenc, including transparency and disposal', () => {
    const w = 8;
    const h = 4;
    const red = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) red.set([255, 0, 0, 255], i * 4);
    const green = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) green.set(i % 2 ? [0, 255, 0, 255] : [0, 0, 0, 0], i * 4);
    const enc = GIFEncoder();
    const p1 = quantize(red, 4);
    enc.writeFrame(applyPalette(red, p1), w, h, { palette: p1, delay: 50 });
    const p2 = quantize(green, 4, { format: 'rgba4444', oneBitAlpha: true });
    const transparentIndex = p2.findIndex((c) => c[3] === 0);
    enc.writeFrame(applyPalette(green, p2, 'rgba4444'), w, h, { palette: p2, delay: 120, transparent: true, transparentIndex });
    enc.finish();
    const frames = [...decodeGifFrames(enc.bytes())];
    expect(frames.map((f) => f.delayMs)).toEqual([50, 120]);
    expect(Array.from(frames[0].rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
    // transparent pixels of frame 2 show frame 1 underneath
    expect(Array.from(frames[1].rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(frames[1].rgba.slice(4, 8))).toEqual([0, 255, 0, 255]);
  });

  it('rejects non-GIF data', () => {
    expect(() => parseGif(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

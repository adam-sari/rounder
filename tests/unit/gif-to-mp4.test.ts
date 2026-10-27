import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GIFEncoder } from 'gifenc';
import { describeSaving, gifStats, MIN_SECONDS, playsFor, savedPercent } from '@/tools/lib/gif-to-mp4/gif';
import gifToMp4 from '@/tools/defs/gif-to-mp4';
import videoToGif from '@/tools/defs/video-to-gif';

describe('gifStats', () => {
  it('reads size, frames and running time from the fixture', () => {
    const stats = gifStats(new Uint8Array(readFileSync('tests/fixtures/media/sample.gif')));
    expect(stats).toEqual({ width: 160, height: 90, frames: 20, durationMs: 2000 });
  });

  it('sums mixed delays and rejects non-GIFs', () => {
    const gif = GIFEncoder();
    const index = new Uint8Array(4);
    for (const delay of [50, 120, 300]) gif.writeFrame(index, 2, 2, { palette: [[0, 0, 0], [255, 255, 255]], delay });
    gif.finish();
    expect(gifStats(gif.bytes())).toMatchObject({ width: 2, height: 2, frames: 3, durationMs: 470 });
    expect(() => gifStats(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow();
  });
});

describe('playsFor', () => {
  it('uses a fixed count as given', () => {
    expect(playsFor(500, 3)).toBe(3);
  });

  it('repeats short GIFs until they last the minimum', () => {
    expect(playsFor(1000, 0)).toBe(3);
    expect(playsFor(1500, 0)).toBe(2);
    expect(playsFor(700, 0) * 700).toBeGreaterThanOrEqual(MIN_SECONDS * 1000);
    expect(playsFor(4000, 0)).toBe(1);
  });
});

describe('savings', () => {
  it('describes smaller, bigger and equal results honestly', () => {
    expect(savedPercent(1000, 120)).toBe(88);
    expect(describeSaving(1000, 120)).toBe('88% smaller');
    expect(describeSaving(1000, 1500)).toBe('50% bigger');
    expect(describeSaving(1000, 1000)).toBe('same size');
    expect(savedPercent(0, 10)).toBe(0);
  });
});

describe('page copy', () => {
  it.each([gifToMp4, videoToGif])('$slug stays within search limits', (tool) => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
    expect(tool.steps).toHaveLength(3);
    expect(tool.faq.at(-1)?.q).toMatch(/uploaded/);
  });
});

import { describe, expect, it } from 'vitest';
import { contactSheetLayout, FRAME_CAP, frameFileName, frameNumber, planFrameTimes, stepTime } from '@/tools/lib/video-frame-extractor/frames';
import def from '@/tools/defs/video-frame-extractor';

describe('planFrameTimes', () => {
  it('spreads a count evenly, centred in each slot', () => {
    const { times, wanted } = planFrameTimes('count', { start: 0, end: 10, count: 5 });
    expect(wanted).toBe(5);
    expect(times).toEqual([1, 3, 5, 7, 9]);
  });

  it('steps every X seconds from the start', () => {
    expect(planFrameTimes('interval', { start: 2, end: 5, interval: 1 }).times).toEqual([2, 3, 4]);
    expect(planFrameTimes('interval', { start: 0, end: 5.5, interval: 2 }).times).toEqual([0, 2, 4]);
  });

  it('lands mid-frame for every frame in a range', () => {
    const { times, wanted } = planFrameTimes('all', { start: 1, end: 1.1, fps: 30 });
    expect(wanted).toBe(3);
    expect(times.map((t) => Math.round(t * 30 * 10) / 10)).toEqual([30.5, 31.5, 32.5]);
  });

  it('defaults to 30 fps when the rate is unknown', () => {
    expect(planFrameTimes('all', { start: 0, end: 1, fps: null }).wanted).toBe(30);
  });

  it('caps big batches but reports what was asked for', () => {
    const all = planFrameTimes('all', { start: 0, end: 60, fps: 30 });
    expect(all.wanted).toBe(1800);
    expect(all.times).toHaveLength(FRAME_CAP);
    const many = planFrameTimes('count', { start: 0, end: 100, count: 2000 });
    expect(many.times).toHaveLength(FRAME_CAP);
    expect(many.times[FRAME_CAP - 1]).toBeGreaterThan(99);
  });

  it('never plans more frames than the range holds', () => {
    // 0.2 s at 30 fps is 6 frames: asking for 12 would save each one twice
    expect(planFrameTimes('count', { start: 1, end: 1.2, count: 12, fps: 30 }).times).toHaveLength(6);
    expect(planFrameTimes('count', { start: 0, end: 10, count: 12, fps: 30 }).times).toHaveLength(12);
    expect(planFrameTimes('interval', { start: 0, end: 1, interval: 0.01, fps: 25 }).times).toHaveLength(25);
  });

  it('returns nothing for an empty range', () => {
    expect(planFrameTimes('count', { start: 3, end: 3, count: 4 })).toEqual({ times: [], wanted: 0 });
  });
});

describe('frame stepping', () => {
  it('numbers frames and steps to the middle of the neighbour', () => {
    expect(frameNumber(1, 30)).toBe(30);
    expect(frameNumber(1.0499, 30)).toBe(31);
    expect(stepTime(1, 30, 1, 10) * 30).toBeCloseTo(31.5);
    expect(stepTime(1, 30, -1, 10) * 30).toBeCloseTo(29.5);
    expect(stepTime(0, 30, -1, 10)).toBe(0);
    expect(stepTime(9.99, 30, 1, 10)).toBeLessThan(10);
  });
});

describe('frameFileName', () => {
  it('stamps minutes, seconds and milliseconds', () => {
    expect(frameFileName('holiday.mp4', 75.5, 'png')).toBe('holiday_01-15.500.png');
    expect(frameFileName('clip.final.mov', 0.0334, 'jpg')).toBe('clip.final_00-00.033.jpg');
    expect(frameFileName('long.mkv', 3723.25, 'webp', true)).toBe('long_01-02-03.250.webp');
    expect(frameFileName('long.mkv', 3723.25, 'webp')).toBe('long_62-03.250.webp');
  });
});

describe('contactSheetLayout', () => {
  it('lays tiles out in rows', () => {
    const l = contactSheetLayout(10, 1920, 1080, { columns: 4, width: 2400, gap: 10, pad: 20, header: 50 });
    expect(l.rows).toBe(3);
    expect(l.tileWidth).toBe(Math.floor((2400 - 40 - 30) / 4));
    expect(l.tileHeight).toBe(Math.round((l.tileWidth * 1080) / 1920));
    expect(l.width).toBeLessThanOrEqual(2400);
    expect(l.cells[5]).toEqual({ x: 20 + (l.tileWidth + 10), y: 20 + 50 + l.tileHeight + 10 });
    expect(l.height).toBe(40 + 50 + 3 * l.tileHeight + 20);
  });

  it('never upscales small frames and never uses more columns than frames', () => {
    const l = contactSheetLayout(2, 320, 240, { columns: 6 });
    expect(l.columns).toBe(2);
    expect(l.tileWidth).toBe(320);
  });

  it('shrinks to fit canvas limits', () => {
    const l = contactSheetLayout(500, 1920, 1080, { columns: 3 });
    expect(l.height).toBeLessThanOrEqual(16_384);
    expect(l.width * l.height).toBeLessThanOrEqual(16_000_000);
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(def.slug).toBe('video-frame-extractor');
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
    expect(def.keywords.length).toBeGreaterThanOrEqual(6);
    expect(def.keywords.length).toBeLessThanOrEqual(10);
    expect(def.steps).toHaveLength(3);
    expect(def.faq.length).toBeGreaterThanOrEqual(3);
    expect(def.faq.length).toBeLessThanOrEqual(5);
  });
});

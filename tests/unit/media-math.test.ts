import { describe, expect, it } from 'vitest';
import {
  bitrateForTargetSize,
  estimateSizeBytes,
  formatTime,
  invertSegments,
  normalizeSegments,
  outputToSourceTime,
  parseTime,
  planVideoSize,
  segmentsDuration,
  snapAudioBitrate,
  spreadTimes,
} from '@/engines/media/math';

describe('formatTime / parseTime', () => {
  it('formats minutes, seconds and hundredths', () => {
    expect(formatTime(0)).toBe('00:00.00');
    expect(formatTime(75.5)).toBe('01:15.50');
    expect(formatTime(3723.456, 3)).toBe('1:02:03.456');
    expect(formatTime(59.999)).toBe('01:00.00'); // rounds up across the minute
    expect(formatTime(-3)).toBe('00:00.00');
    expect(formatTime(12.3, 0)).toBe('00:12');
  });

  it('parses the formats people type', () => {
    expect(parseTime('75.5')).toBe(75.5);
    expect(parseTime('1:15.5')).toBe(75.5);
    expect(parseTime('01:15,50')).toBe(75.5);
    expect(parseTime('1:02:03')).toBe(3723);
    expect(parseTime(' 0:05 ')).toBe(5);
    expect(parseTime('90:00')).toBe(5400);
  });

  it('rejects nonsense', () => {
    for (const bad of ['', 'abc', '1:75', '1.5:20', '1:2:3:4', '-3', ':', '.']) expect(parseTime(bad)).toBeNull();
  });

  it('round-trips', () => {
    for (const t of [0, 1.25, 59.99, 61.5, 3599.99, 7322.1]) expect(parseTime(formatTime(t))).toBeCloseTo(t, 2);
  });
});

describe('planVideoSize', () => {
  it('keeps aspect with one side and evens the result', () => {
    expect(planVideoSize(1920, 1080, { width: 1280 })).toMatchObject({ width: 1280, height: 720 });
    expect(planVideoSize(1918, 1080, { height: 361 })).toMatchObject({ height: 362 });
    expect(planVideoSize(641, 359, {})).toMatchObject({ width: 642, height: 360 });
  });

  it('swaps sides for 90/270 rotation, then crops, then scales', () => {
    const p = planVideoSize(1920, 1080, { rotate: 90 });
    expect([p.width, p.height]).toEqual([1080, 1920]);
    const c = planVideoSize(1920, 1080, { crop: { x: 100, y: 0, width: 608, height: 1080 }, scale: 0.5 });
    expect([c.sourceWidth, c.sourceHeight, c.width, c.height]).toEqual([608, 1080, 304, 540]);
  });

  it('clamps crops that overflow the frame', () => {
    const c = planVideoSize(640, 360, { crop: { x: 600, y: -20, width: 400, height: 400 } });
    expect([c.sourceWidth, c.sourceHeight]).toEqual([40, 360]);
  });

  it('uses the requested box for 9:16 with cover', () => {
    expect(planVideoSize(1920, 1080, { width: 1080, height: 1920, fit: 'cover' })).toMatchObject({ width: 1080, height: 1920, fit: 'cover' });
  });
});

describe('bitrateForTargetSize', () => {
  it('fills the budget minus audio and overhead', () => {
    const r = bitrateForTargetSize(8_000_000, 60, { audioBitrate: 128_000 });
    // 8 MB * 8 * 0.95 / 60 s = 1,013,333 b/s total
    expect(r.videoBitrate).toBe(1_013_333 - 128_000);
    expect(r.feasible).toBe(true);
    expect(estimateSizeBytes(60, r.videoBitrate, r.audioBitrate)).toBeLessThan(8_000_000);
  });

  it('starves audio before video on tiny budgets', () => {
    const r = bitrateForTargetSize(1_000_000, 60, { audioBitrate: 128_000 });
    expect(r.audioBitrate).toBeLessThan(128_000);
    expect(r.videoBitrate).toBeGreaterThan(r.audioBitrate);
  });

  it('gives video what is left after the audio encoder rounds its rate', () => {
    // 150 KB over 3 s: total 380 kb/s; audio starves to 127k, AAC snaps it to 128k
    const r = bitrateForTargetSize(150_000, 3, { audioBitrate: 128_000, snapAudio: (b) => snapAudioBitrate('aac', b)! });
    expect(r.audioBitrate).toBe(128_000);
    expect(r.videoBitrate).toBe(380_000 - 128_000);
  });

  it('flags impossible targets', () => {
    expect(bitrateForTargetSize(100_000, 600).feasible).toBe(false);
    expect(bitrateForTargetSize(1e6, 0).feasible).toBe(false);
  });
});

describe('segments', () => {
  it('normalizes: sorts, clamps, merges, drops slivers', () => {
    expect(
      normalizeSegments(
        [
          { start: 5, end: 3 },
          { start: 8, end: 12 },
          { start: 1, end: 4 },
          { start: 9.5, end: 9.5005 },
        ],
        10,
      ),
    ).toEqual([
      { start: 1, end: 5 },
      { start: 8, end: 10 },
    ]);
  });

  it('inverts cuts into keeps', () => {
    const keep = invertSegments([{ start: 2, end: 3 }, { start: 7, end: 10 }], 10);
    expect(keep).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 7 },
    ]);
    expect(segmentsDuration(keep)).toBe(6);
    expect(invertSegments([], 4)).toEqual([{ start: 0, end: 4 }]);
  });

  it('maps output time back to source time', () => {
    const keep = [
      { start: 0, end: 2 },
      { start: 3, end: 7 },
    ];
    expect(outputToSourceTime(keep, 1)).toBe(1);
    expect(outputToSourceTime(keep, 2.5)).toBe(3.5);
    expect(outputToSourceTime(keep, 99)).toBe(7);
  });

  it('spreads thumbnail times across the middle of each slot', () => {
    expect(spreadTimes(4, 0, 8)).toEqual([1, 3, 5, 7]);
  });
});

describe('snapAudioBitrate', () => {
  it('rounds AAC to the rates native encoders accept', () => {
    expect(snapAudioBitrate('aac', 127_000)).toBe(128_000);
    expect(snapAudioBitrate('aac', 24_000)).toBe(96_000);
    expect(snapAudioBitrate('aac', 320_000)).toBe(192_000);
  });
  it('uses the MP3 ladder and clamps Opus/Vorbis', () => {
    expect(snapAudioBitrate('mp3', 150_000)).toBe(160_000);
    expect(snapAudioBitrate('opus', 2_000)).toBe(6_000);
    expect(snapAudioBitrate('opus', 96_400)).toBe(96_000);
    expect(snapAudioBitrate('vorbis', 8_000)).toBe(32_000);
  });
  it('ignores lossless codecs', () => {
    expect(snapAudioBitrate('flac', 128_000)).toBeUndefined();
    expect(snapAudioBitrate('pcm-s16', 128_000)).toBeUndefined();
  });
});

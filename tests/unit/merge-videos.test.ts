import { describe, expect, it } from 'vitest';
import tools from '@/tools/defs/merge-videos';
import {
  clipLength,
  clock,
  etaSeconds,
  friendlyError,
  isTrimmed,
  moveItem,
  musicFit,
  needsPrepass,
  overallProgress,
  percentToDb,
  planStages,
  prepSize,
  resolveSize,
  totalLength,
  type ClipPlan,
} from '@/tools/lib/merge-videos/plan';

const clip = (width: number, height: number, duration: number, start = 0, end = duration): ClipPlan => ({ width, height, duration, start, end });

describe('resolveSize', () => {
  const clips = [clip(1280, 720, 10), clip(1080, 1920, 5), clip(641, 359, 3)];
  it('matches the first clip or the biggest one', () => {
    expect(resolveSize('first', clips)).toEqual({ width: 1280, height: 720 });
    expect(resolveSize('largest', clips)).toEqual({ width: 1080, height: 1920 });
  });
  it('rounds odd sizes to even numbers', () => {
    expect(resolveSize('first', [clips[2]])).toEqual({ width: 642, height: 360 });
  });
  it('returns presets regardless of clips', () => {
    expect(resolveSize('vertical', [])).toMatchObject({ width: 1080, height: 1920 });
    expect(resolveSize('1080p', clips)).toMatchObject({ width: 1920, height: 1080 });
  });
  it('has nothing to match without clips', () => {
    expect(resolveSize('first', [])).toBeNull();
  });
});

describe('trim and lengths', () => {
  it('ignores handles that sit at the edges', () => {
    expect(isTrimmed(clip(1, 1, 10, 0.01, 9.99))).toBe(false);
    expect(isTrimmed(clip(1, 1, 10, 1, 10))).toBe(true);
    expect(isTrimmed(clip(1, 1, 10, 0, 8))).toBe(true);
  });
  it('sums the kept parts', () => {
    expect(clipLength(clip(1, 1, 10, 2, 7))).toBe(5);
    expect(totalLength([clip(1, 1, 10, 2, 7), clip(1, 1, 4)])).toBe(9);
  });
});

describe('needsPrepass', () => {
  const target = { width: 1920, height: 1080 };
  it('only re-encodes clips concat cannot handle alone', () => {
    expect(needsPrepass(clip(1280, 720, 5), target, 'fill')).toBe(false);
    expect(needsPrepass(clip(1080, 1920, 5), target, 'letterbox')).toBe(false);
    expect(needsPrepass(clip(1080, 1920, 5), target, 'fill')).toBe(true);
    expect(needsPrepass(clip(1280, 720, 5, 1, 4), target, 'letterbox')).toBe(true);
  });
});

describe('prepSize', () => {
  const target = { width: 1280, height: 720 };
  it('crops other shapes to the target when filling', () => {
    expect(prepSize({ width: 1080, height: 1920 }, target, 'fill')).toEqual({ width: 1280, height: 720, fit: 'cover' });
  });
  it('only shrinks clips that are bigger than the target', () => {
    expect(prepSize({ width: 3840, height: 2160 }, target, 'letterbox')).toEqual({ width: 1280 });
    expect(prepSize({ width: 1080, height: 1920 }, target, 'letterbox')).toEqual({ width: 406 });
    expect(prepSize({ width: 640, height: 360 }, target, 'fill')).toEqual({});
  });
});

describe('planStages', () => {
  const target = { width: 1280, height: 720 };
  it('prepares trimmed clips, joins, then fixes the sound', () => {
    const stages = planStages([clip(1280, 720, 10, 0, 5), clip(1280, 720, 10)], target, 'letterbox', 'music');
    expect(stages.map((s) => s.kind)).toEqual(['prepare', 'join', 'music']);
    expect(stages[0].clip).toBe(0);
    expect(stages.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1);
  });
  it('is a single join when nothing needs work', () => {
    const stages = planStages([clip(1280, 720, 3), clip(1280, 720, 3)], target, 'letterbox', 'keep');
    expect(stages).toEqual([{ kind: 'join', weight: 1 }]);
  });
  it('maps stage progress onto one bar', () => {
    const stages = planStages([clip(1280, 720, 10, 0, 5), clip(1280, 720, 15)], target, 'letterbox', 'keep');
    // prepare weighs 5 s, join 20 s
    expect(overallProgress(stages, 0, 1)).toBeCloseTo(0.2);
    expect(overallProgress(stages, 1, 0.5)).toBeCloseTo(0.6);
    expect(overallProgress(stages, 1, 2)).toBe(1);
  });
});

describe('small helpers', () => {
  it('formats clocks and guesses the time left', () => {
    expect(clock(65.4)).toBe('1:05');
    expect(clock(3723)).toBe('1:02:03');
    expect(etaSeconds(10, 0.5)).toBe(10);
    expect(etaSeconds(10, 0.01)).toBeNull();
  });
  it('turns volume percent into dB', () => {
    expect(percentToDb(100)).toBe(0);
    expect(percentToDb(200)).toBeCloseTo(6.02, 1);
    expect(percentToDb(50)).toBeCloseTo(-6.02, 1);
  });
  it('moves items and ignores bad moves', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    const list = ['a'];
    expect(moveItem(list, 0, 3)).toBe(list);
  });
  it('explains music length', () => {
    expect(musicFit(60, 90)).toMatch(/0:30 before the video/);
    expect(musicFit(100, 90)).toMatch(/cut off/);
    expect(musicFit(90.2, 90)).toMatch(/about as long/);
  });
  it('keeps engine messages that are already user-facing', () => {
    expect(friendlyError('unsupported-input', 'File 2 can’t be decoded.')).toBe('File 2 can’t be decoded.');
    expect(friendlyError('out-of-memory', 'x')).toMatch(/memory/);
    expect(friendlyError(undefined, 'boom')).toMatch(/boom$/);
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(tools.title.length).toBeLessThanOrEqual(65);
    expect(tools.description.length).toBeLessThanOrEqual(160);
    expect(tools.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tools.steps).toHaveLength(3);
  });
});

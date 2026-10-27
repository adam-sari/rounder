import { describe, expect, it } from 'vitest';
import {
  errorText, fadeGain, fileBase, fitDurations, formatEta, frameState, inkFor, MIN_SLIDE_SEC, outputSize, resolveDurations, slideStarts, total,
  transitionLength, wrapLines,
} from '../../src/tools/lib/slideshow-maker/plan';
import tool from '../../src/tools/defs/slideshow-maker';

describe('outputSize', () => {
  it('sizes each aspect by its short side', () => {
    expect(outputSize('16:9', 1080)).toEqual({ w: 1920, h: 1080 });
    expect(outputSize('9:16', 1080)).toEqual({ w: 1080, h: 1920 });
    expect(outputSize('1:1', 720)).toEqual({ w: 720, h: 720 });
    expect(outputSize('4:5', 1080)).toEqual({ w: 1080, h: 1350 });
  });

  it('always gives even sides', () => {
    const { w, h } = outputSize('16:9', 450);
    expect(w % 2).toBe(0);
    expect(h % 2).toBe(0);
  });
});

describe('durations', () => {
  it('uses each slide override, else the global value', () => {
    expect(resolveDurations([null, 5, null], 3)).toEqual([3, 5, 3]);
  });

  it('fits free slides into what the music leaves', () => {
    const { durations, overridesKept } = fitDurations([null, 4, null, null], 31);
    expect(overridesKept).toBe(true);
    expect(durations).toEqual([9, 4, 9, 9]);
    expect(total(durations)).toBeCloseTo(31);
  });

  it('shares the time evenly when overrides leave too little', () => {
    const { durations, overridesKept } = fitDurations([10, null, 10], 12);
    expect(overridesKept).toBe(false);
    expect(durations).toEqual([4, 4, 4]);
  });

  it('never goes below the minimum slide length', () => {
    const { durations } = fitDurations([null, null], 0.2);
    expect(durations.every((d) => d === MIN_SLIDE_SEC)).toBe(true);
  });

  it('lists slide start times', () => {
    expect(slideStarts([3, 2.5, 4])).toEqual([0, 3, 5.5]);
  });
});

describe('frameState (mirrors imagesToVideo)', () => {
  const durs = [3, 3, 3];
  const T = transitionLength(durs, 'fade');

  it('caps the transition at half the shortest slide', () => {
    expect(T).toBe(0.7);
    expect(transitionLength([3, 1, 3], 'fade')).toBe(0.5);
    expect(transitionLength(durs, 'none')).toBe(0);
  });

  it('shows one slide outside transitions', () => {
    expect(frameState(1.5, durs, T)).toEqual({ slot: 0, local: 0.5, mix: null });
    expect(frameState(4, durs, T).slot).toBe(1);
  });

  it('mixes into the next slide during the last T seconds', () => {
    const mid = frameState(3 - T / 2, durs, T);
    expect(mid.slot).toBe(0);
    expect(mid.mix).toBeCloseTo(0.5);
  });

  it('never transitions out of the last slide and clamps past the end', () => {
    expect(frameState(8.9, durs, T)).toMatchObject({ slot: 2, mix: null });
    expect(frameState(20, durs, T)).toEqual({ slot: 2, local: 1, mix: null });
  });
});

describe('fadeGain', () => {
  it('ramps in and out and is silent outside the clip', () => {
    expect(fadeGain(0, 10, 2, 2)).toBe(0);
    expect(fadeGain(1, 10, 2, 2)).toBe(0.5);
    expect(fadeGain(5, 10, 2, 2)).toBe(1);
    expect(fadeGain(9.5, 10, 2, 2)).toBe(0.25);
    expect(fadeGain(11, 10, 2, 2)).toBe(0);
    expect(fadeGain(0, 10, 0, 0)).toBe(1);
  });
});

describe('text helpers', () => {
  it('turns titles into file names', () => {
    expect(fileBase('Summer in Lisbon!')).toBe('summer-in-lisbon');
    expect(fileBase('Café Ölmühle')).toBe('cafe-olmuhle');
    expect(fileBase('  ')).toBe('slideshow');
  });

  it('wraps words to a width', () => {
    const measure = (s: string) => s.length;
    expect(wrapLines('one two three four', 9, measure)).toEqual(['one two', 'three', 'four']);
    expect(wrapLines('a\nb c', 10, measure)).toEqual(['a', 'b c']);
    expect(wrapLines('', 10, measure)).toEqual([]);
  });

  it('picks readable ink for a background', () => {
    expect(inkFor('#ffffff')).toBe('#131211');
    expect(inkFor('#000000')).toBe('#ffffff');
    expect(inkFor('oops')).toBe('#ffffff');
  });

  it('formats remaining time', () => {
    expect(formatEta(42.4)).toBe('42s');
    expect(formatEta(65)).toBe('1m 05s');
    expect(formatEta(NaN)).toBe('…');
  });

  it('explains failures by code', () => {
    expect(errorText('out-of-memory', '')).toMatch(/memory/);
    expect(errorText('invalid-options', 'Add at least one image.')).toBe('Add at least one image.');
    expect(errorText(undefined, 'boom')).toMatch(/boom/);
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
  });
});

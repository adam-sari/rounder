import { describe, expect, it } from 'vitest';
import { buildCues, joinWords, longestLine, mergeCues, SHORT_CUES, splitCue, splitLines, SUBTITLE_CUES, type Word } from '@/tools/lib/subtitle-cues';
import def from '@/tools/defs/subtitle-generator';

/** words at a steady pace: each `dur` long with `gap` between them */
function speak(text: string, start = 0, dur = 0.3, gap = 0.05): Word[] {
  let t = start;
  return text.split(' ').map((w) => {
    const word = { text: ` ${w}`, start: t, end: t + dur };
    t += dur + gap;
    return word;
  });
}

describe('splitLines', () => {
  it('keeps short text on one line', () => {
    expect(splitLines('Hello there.', 42, 2)).toBe('Hello there.');
  });
  it('balances two lines within the limit', () => {
    const out = splitLines('This sentence is a little too long to fit on just one line', 42, 2);
    const [a, b] = out.split('\n');
    expect(out.split('\n')).toHaveLength(2);
    expect(a.length).toBeLessThanOrEqual(42);
    expect(b.length).toBeLessThanOrEqual(42);
    expect(Math.abs(a.length - b.length)).toBeLessThan(12);
  });
  it('prefers breaking after a comma', () => {
    expect(splitLines('When we got there, the whole place was already closed', 42, 2)).toBe('When we got there,\nthe whole place was already closed');
  });
  it('splits unspaced scripts by character', () => {
    const text = '今日はとても良い天気ですね散歩に行きましょうかそれとも家にいましょうか';
    const out = splitLines(text, 20, 2).split('\n');
    expect(out).toHaveLength(2);
    expect(out.join('')).toBe(text);
  });
  it('never drops text that does not fit', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve';
    expect(splitLines(text, 10, 2).replace('\n', ' ')).toBe(text);
  });
});

describe('buildCues', () => {
  it('respects line length, line count and duration', () => {
    const words = speak('So today I want to talk about something that has been on my mind for a really long time and I think a lot of you will relate to it because we all go through it at some point in our lives');
    const cues = buildCues(words);
    expect(cues.length).toBeGreaterThan(2);
    for (const c of cues) {
      expect(longestLine(c.text)).toBeLessThanOrEqual(SUBTITLE_CUES.maxLineChars);
      expect(c.text.split('\n').length).toBeLessThanOrEqual(2);
      expect(c.end - c.start).toBeLessThanOrEqual(SUBTITLE_CUES.maxDuration + 1e-9);
      expect(c.end).toBeGreaterThan(c.start);
    }
    // every word survives, in order
    expect(cues.map((c) => c.text.replace('\n', ' ')).join(' ')).toBe(joinWords(words));
  });

  it('starts a new cue after a pause', () => {
    const words = [...speak('Hi there'), ...speak('how are you', 5)];
    const cues = buildCues(words);
    expect(cues.map((c) => c.text)).toEqual(['Hi there', 'how are you']);
  });

  it('starts a new cue at the end of a sentence once the cue has some length', () => {
    const cues = buildCues(speak('We finally made it to the top. Then it started raining on us.'));
    expect(cues[0].text).toBe('We finally made it to the top.');
    expect(cues[1].text).toBe('Then it started raining on us.');
  });

  it('keeps a very short sentence with the next one', () => {
    const cues = buildCues(speak('Yes. That is right.'));
    expect(cues).toHaveLength(1);
  });

  it('holds short cues for at least the minimum, without overlapping the next', () => {
    const words = [{ text: ' Oh!', start: 1, end: 1.2 }, ...speak('Look at that', 1.9)];
    const cues = buildCues(words);
    expect(cues[0].end).toBeCloseTo(1.9, 5);
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start);
    const lone = buildCues([{ text: ' Oh!', start: 1, end: 1.2 }]);
    expect(lone[0].end).toBeCloseTo(2, 5);
  });

  it('short style makes single short lines', () => {
    const cues = buildCues(speak('This is going to be a quick one but it still has more words than one line can hold'), SHORT_CUES);
    for (const c of cues) {
      expect(c.text).not.toContain('\n');
      expect(c.text.length).toBeLessThanOrEqual(SHORT_CUES.maxLineChars);
    }
  });

  it('backs up to a comma rather than breaking mid-phrase', () => {
    const cues = buildCues(speak('If you have ever tried to bake bread at home, you know it takes patience and a lot of flour everywhere'));
    expect(cues[0].text.replace('\n', ' ')).toBe('If you have ever tried to bake bread at home,');
  });

  it('joins CJK words without spaces', () => {
    const words: Word[] = [
      { text: '今日は', start: 0, end: 0.5 },
      { text: '晴れです。', start: 0.5, end: 1.2 },
    ];
    expect(buildCues(words)[0].text).toBe('今日は晴れです。');
  });

  it('skips empty words and handles no words', () => {
    expect(buildCues([])).toEqual([]);
    expect(buildCues([{ text: ' ', start: 0, end: 1 }])).toEqual([]);
  });
});

describe('editing', () => {
  it('splits at a word boundary using the word times', () => {
    const [cue] = buildCues(speak('one two three four'));
    const [a, b] = splitCue(cue);
    expect(a.text).toBe('one two');
    expect(b.text).toBe('three four');
    expect(a.end).toBeCloseTo(cue.words![1].end, 5);
    expect(b.start).toBeCloseTo(cue.words![2].start, 5);
    expect(a.start).toBe(cue.start);
    expect(b.end).toBe(cue.end);
  });

  it('splits edited text by length when the word times are gone', () => {
    const [a, b] = splitCue({ start: 10, end: 14, text: 'aaaa bbbb' });
    expect([a.text, b.text]).toEqual(['aaaa', 'bbbb']);
    expect(a.end).toBe(12);
    expect(b.start).toBe(12);
  });

  it('leaves a single word alone but splits unspaced scripts by character', () => {
    const cue = { start: 0, end: 1, text: 'Hello' };
    expect(splitCue(cue)).toEqual([cue]);
    expect(splitCue({ start: 0, end: 2, text: '今日は晴れ' }).map((c) => c.text)).toEqual(['今日', 'は晴れ']);
  });

  it('merges two cues and keeps the timings and extra fields', () => {
    const [a, b] = buildCues([...speak('First part'), ...speak('second part', 4)]).map((c, i) => ({ ...c, id: i }));
    const m = mergeCues(a, b);
    expect(m.text).toBe('First part second part');
    expect(m.start).toBe(a.start);
    expect(m.end).toBe(b.end);
    expect(m.id).toBe(0);
    expect(m.words).toHaveLength(4);
  });

  it('merges edited cues by text', () => {
    const m = mergeCues({ start: 0, end: 1, text: 'Edited' }, { start: 1, end: 2, text: 'text' });
    expect(m).toMatchObject({ start: 0, end: 2, text: 'Edited text', words: undefined });
  });
});

describe('page', () => {
  it('fits search limits', () => {
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
    expect(def.keywords.length).toBeGreaterThanOrEqual(6);
    expect(def.steps).toHaveLength(3);
    expect(def.category).toBe('ai');
  });
});

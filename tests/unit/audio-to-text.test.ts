import { describe, expect, it } from 'vitest';
import { formatMB } from '@/engines/ai/progress';
import { totalDownloadSize } from '@/engines/ai/models';
import def from '@/tools/defs/audio-to-text';
import subtitles from '@/tools/defs/subtitle-generator';
import { languageName, languageOptions, toWhisperLanguage, WHISPER_LANGUAGES } from '@/tools/lib/whisper/languages';
import { frameLevels, planWindows, SAMPLE_RATE, WINDOWS, windowsDuration } from '@/tools/lib/whisper/segment';
import { clock, placeWords, toJson, toTxt, transcriptLines, transcriptSrt, transcriptVtt } from '@/tools/lib/whisper/transcript';

const R = SAMPLE_RATE;

/** silence, with a 200 Hz tone (≈ -9 dBFS) wherever `speech` says, plus faint noise */
function audio(seconds: number, speech: [number, number][]): Float32Array {
  const out = new Float32Array(seconds * R);
  let seed = 1;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] = (seed / 2147483647 - 0.5) * 0.002;
  }
  for (const [a, b] of speech) for (let i = a * R; i < b * R; i++) out[i] += 0.5 * Math.sin((2 * Math.PI * 200 * i) / R);
  return out;
}

const secs = (w: { start: number; end: number }) => [w.start / R, w.end / R];

describe('planWindows', () => {
  it('finds nothing in silence', () => {
    expect(planWindows(new Float32Array(10 * R))).toEqual([]);
    expect(planWindows(audio(10, []))).toEqual([]);
  });

  it('covers speech with a little padding and skips long silences', () => {
    const w = planWindows(audio(60, [[2, 6], [40, 44]]));
    expect(w).toHaveLength(2);
    const [[a0, b0], [a1, b1]] = w.map(secs);
    expect(a0).toBeLessThanOrEqual(2);
    expect(a0).toBeGreaterThan(1.5);
    expect(b0).toBeGreaterThanOrEqual(6);
    expect(b0).toBeLessThan(6.5);
    expect(a1).toBeLessThanOrEqual(40);
    expect(b1).toBeGreaterThanOrEqual(44);
  });

  it('keeps nearby phrases in one window', () => {
    const w = planWindows(audio(20, [[1, 3], [4, 6], [7, 9]]));
    expect(w).toHaveLength(1);
  });

  it('never makes a window longer than the limit, even for nonstop sound', () => {
    const w = planWindows(audio(95, [[0, 95]]));
    expect(w.length).toBeGreaterThanOrEqual(4);
    for (const x of w) expect((x.end - x.start) / R).toBeLessThanOrEqual(WINDOWS.maxSec + 1e-6);
    // contiguous: nothing lost between the cuts
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end);
    expect(windowsDuration(w)).toBeCloseTo(95, 0);
  });

  it('cuts long stretches at a quiet moment', () => {
    // 40 s of sound with a short dip at 20 s (too short to count as a pause)
    const a = audio(40, [[0, 20], [20.3, 40]]);
    const w = planWindows(a);
    expect(w.length).toBe(2);
    expect(w[0].end / R).toBeGreaterThanOrEqual(20);
    expect(w[0].end / R).toBeLessThanOrEqual(20.3);
  });

  it('ignores clicks', () => {
    expect(planWindows(audio(10, [[5, 5.04]]))).toEqual([]);
  });

  it('measures frame levels in dBFS', () => {
    const levels = frameLevels(audio(1, [[0, 1]]));
    expect(levels.length).toBe(50);
    expect(levels[10]).toBeGreaterThan(-12);
    expect(levels[10]).toBeLessThan(-6);
  });
});

describe('placeWords', () => {
  it('moves words onto the file timeline and fills missing ends', () => {
    const words = placeWords(
      [
        { text: ' Hello', timestamp: [0.5, 0.9] },
        { text: ' ', timestamp: [0.9, 1] },
        { text: ' world.', timestamp: [1.0, null] },
      ],
      10,
      12,
    );
    expect(words).toEqual([
      { text: ' Hello', start: 10.5, end: 10.9 },
      { text: ' world.', start: 11, end: 12 },
    ]);
  });

  it('keeps words timed past the window inside it', () => {
    const [w] = placeWords([{ text: ' bye', timestamp: [29.2, 29.8] }], 10, 34);
    expect(w.start).toBeLessThan(w.end);
    expect(w.end).toBe(34);
    expect(w.start).toBeCloseTo(33.95);
  });

  it('drops runaway repeats', () => {
    const raw = Array.from({ length: 8 }, (_, i) => ({ text: ' the', timestamp: [i, i + 0.5] as [number, number] }));
    expect(placeWords(raw, 0, 10)).toHaveLength(3);
  });

  it('never lets a word end before it starts', () => {
    const [w] = placeWords([{ text: ' hi', timestamp: [2, 1.5] }], 0, 5);
    expect(w.end).toBeGreaterThan(w.start);
  });
});

describe('transcript output', () => {
  const words = [
    { text: ' Good', start: 0, end: 0.4 },
    { text: ' morning.', start: 0.4, end: 1 },
    { text: ' Shall', start: 4, end: 4.3 },
    { text: ' we', start: 4.3, end: 4.5 },
    { text: ' start?', start: 4.5, end: 5 },
  ];

  it('formats clock times', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(75.4)).toBe('1:15');
    expect(clock(3723)).toBe('1:02:03');
  });

  it('groups lines at long pauses', () => {
    expect(transcriptLines(words).map((l) => l.text)).toEqual(['Good morning.', 'Shall we start?']);
  });

  it('writes plain and timestamped text', () => {
    expect(toTxt(words, false)).toBe('Good morning.\n\nShall we start?');
    expect(toTxt(words, true)).toBe('[0:00] Good morning.\n[0:04] Shall we start?');
  });

  it('writes SRT and VTT', () => {
    expect(transcriptSrt(words)).toContain('00:00:04,000 --> 00:00:05,000\nShall we start?');
    expect(transcriptVtt(words).startsWith('WEBVTT')).toBe(true);
  });

  it('writes JSON with segments and words', () => {
    const json = JSON.parse(toJson(words, { model: 'Whisper base', language: 'en', task: 'transcribe', duration: 6 }));
    expect(json).toMatchObject({ model: 'Whisper base', language: 'en', text: 'Good morning. Shall we start?' });
    expect(json.segments).toHaveLength(2);
    expect(json.segments[1].words[0]).toEqual({ word: 'Shall', start: 4, end: 4.3 });
  });
});

describe('languages', () => {
  it('names every language and maps oddities', () => {
    expect(WHISPER_LANGUAGES).toHaveLength(99);
    expect(languageName('es')).toBe('Spanish');
    expect(languageName('jw')).toBe('Javanese');
    expect(languageOptions()[0].name.localeCompare(languageOptions()[1].name)).toBeLessThan(0);
    expect(toWhisperLanguage('yue')).toBe('zh');
    expect(toWhisperLanguage('de')).toBe('de');
    expect(toWhisperLanguage('xx')).toBe('en');
  });
});

describe('pages', () => {
  it('fit search limits', () => {
    for (const t of [def, subtitles]) {
      expect(t.title.length).toBeLessThanOrEqual(65);
      expect(t.description.length).toBeLessThanOrEqual(160);
      expect(t.keywords.length).toBeGreaterThanOrEqual(6);
      expect(t.keywords.length).toBeLessThanOrEqual(10);
      expect(t.steps).toHaveLength(3);
      expect(t.category).toBe('ai');
      expect(t.faq.at(-1)?.q).toBe('Are my files uploaded anywhere?');
    }
  });

  it('quotes the real download sizes', () => {
    const copy = JSON.stringify([def, subtitles]);
    for (const [key, variant] of [['whisper-base', 'q8'], ['whisper-base', 'fp16'], ['whisper-tiny', 'q8'], ['whisper-large-turbo', 'q4f16']] as const) {
      expect(copy).toContain(formatMB(totalDownloadSize(key, variant)));
    }
  });
});

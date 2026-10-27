import type { Cue } from '../subtitles/format';

/** One recognized word. `text` keeps Whisper's leading space, which marks a word boundary in spaced scripts. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

/** A cue that still knows its words (lost once the text is edited by hand) */
export interface TimedCue extends Cue {
  words?: Word[];
}

export interface CueOptions {
  /** longest a line may get, in characters */
  maxLineChars: number;
  maxLines: number;
  /** seconds; short cues are held longer when the next one leaves room */
  minDuration: number;
  maxDuration: number;
  /** a silence at least this long (seconds) always starts a new cue */
  pause: number;
  /** a finished sentence starts a new cue once the cue has this many characters */
  sentenceChars: number;
}

/** Netflix-style subtitles: 42 characters a line, two lines, 1–7 seconds */
export const SUBTITLE_CUES: CueOptions = { maxLineChars: 42, maxLines: 2, minDuration: 1, maxDuration: 7, pause: 0.7, sentenceChars: 20 };
/** One short line, for vertical social videos */
export const SHORT_CUES: CueOptions = { ...SUBTITLE_CUES, maxLineChars: 32, maxLines: 1, maxDuration: 4, sentenceChars: 12 };
/** Readable transcript paragraphs: a sentence or a few, split at long pauses */
export const TRANSCRIPT_LINES: CueOptions = { maxLineChars: 320, maxLines: 1, minDuration: 0, maxDuration: 30, pause: 1.5, sentenceChars: 90 };

const SENTENCE_END = /[.!?…。！？]["'”’)\]]*$/;
const CLAUSE_END = /[,;:，、；：—–]["'”’)\]]*$/;
const ms = (t: number) => Math.round(t * 1000) / 1000;

/** Joins words the way they were spoken: spaced scripts keep their spaces, CJK runs together */
export const joinWords = (words: Word[]) => words.map((w) => w.text).join('').replace(/\s+/g, ' ').trim();

/** characters on screen, counting a CJK character like a Latin one */
const length = (s: string) => Array.from(s).length;
/** scripts written without spaces between words, which may break between any two characters */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;

/**
 * Breaks cue text into at most `maxLines` lines no longer than `maxLineChars`, as evenly as
 * possible (a slightly longer bottom line wins ties), preferring a break after punctuation.
 * Text that doesn't fit stays on the last line rather than being cut.
 */
export function splitLines(text: string, maxLineChars: number, maxLines: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (maxLines < 2 || length(flat) <= maxLineChars) return flat;
  const spaced = flat.includes(' ');
  const units = spaced ? flat.split(' ') : UNSPACED.test(flat) ? Array.from(flat) : [flat];
  if (units.length < 2) return flat;
  const sep = spaced ? ' ' : '';
  let best = { score: Infinity, at: 0 };
  for (let i = 1; i < units.length; i++) {
    const top = units.slice(0, i).join(sep);
    const bottom = units.slice(i).join(sep);
    const over = Math.max(0, length(top) - maxLineChars) + Math.max(0, length(bottom) - maxLineChars);
    const score = over * 100 + Math.abs(length(top) - length(bottom)) + (length(top) > length(bottom) ? 0.5 : 0) - (CLAUSE_END.test(top) || SENTENCE_END.test(top) ? 15 : 0);
    if (score < best.score) best = { score, at: i };
  }
  const top = units.slice(0, best.at).join(sep);
  return `${top}\n${splitLines(units.slice(best.at).join(sep), maxLineChars, maxLines - 1)}`;
}

function cueFrom(words: Word[], o: CueOptions): TimedCue {
  return { start: ms(words[0].start), end: ms(words.at(-1)!.end), text: splitLines(joinWords(words), o.maxLineChars, o.maxLines), words };
}

/**
 * Groups timed words into readable cues: a new cue after a pause, after a finished sentence once
 * the cue has some length, and before the text or the duration would overflow (backing up to the
 * last comma or small pause in the second half of the cue when there is one).
 */
export function buildCues(words: Word[], o: CueOptions = SUBTITLE_CUES): TimedCue[] {
  const cues: TimedCue[] = [];
  const capacity = o.maxLineChars * o.maxLines;
  let group: Word[] = [];

  const flush = (upTo = group.length) => {
    if (upTo) cues.push(cueFrom(group.slice(0, upTo), o));
    group = group.slice(upTo);
  };

  for (const w of words) {
    if (!w.text.trim()) continue;
    const prev = group.at(-1);
    if (prev && w.start - prev.end >= o.pause) flush();
    const next = [...group, w];
    if (group.length && (length(joinWords(next)) > capacity || w.end - group[0].start > o.maxDuration)) {
      // back up to a natural break in the second half of the cue, else break before this word
      const half = length(joinWords(group)) / 2;
      let at = 0;
      for (let i = group.length - 1; i > 0 && length(joinWords(group.slice(0, i))) >= half; i--) {
        const gap = group[i].start - group[i - 1].end;
        if (CLAUSE_END.test(group[i - 1].text) || SENTENCE_END.test(group[i - 1].text) || gap >= 0.3) {
          at = i;
          break;
        }
      }
      flush(at || group.length);
    }
    group.push(w);
    if (SENTENCE_END.test(w.text) && length(joinWords(group)) >= o.sentenceChars) flush();
  }
  flush();

  // hold short cues on screen a little longer when the next one leaves room
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const limit = cues[i + 1]?.start ?? Infinity;
    if (c.end - c.start < o.minDuration) c.end = ms(Math.max(c.end, Math.min(c.start + o.minDuration, limit)));
    if (c.end <= c.start) c.end = ms(c.start + 0.1);
  }
  return cues;
}

/** Joins a cue with the one after it, keeping the word timings when both still have them */
export function mergeCues<T extends TimedCue>(a: T, b: T, o: CueOptions = SUBTITLE_CUES): T {
  const words = a.words && b.words ? [...a.words, ...b.words] : undefined;
  const text = words ? joinWords(words) : `${a.text} ${b.text}`;
  return { ...a, start: Math.min(a.start, b.start), end: Math.max(a.end, b.end), text: splitLines(text, o.maxLineChars, o.maxLines), words };
}

/**
 * Splits a cue in two near the middle of its text: at a word boundary with the word's own time
 * when the timings are known, else at the space nearest the middle with time shared by length.
 * A single word can't be split; it comes back alone.
 */
export function splitCue<T extends TimedCue>(cue: T, o: CueOptions = SUBTITLE_CUES): T[] {
  const lines = (t: string) => splitLines(t, o.maxLineChars, o.maxLines);
  if (cue.words && cue.words.length > 1) {
    const total = length(joinWords(cue.words));
    let at = 1;
    let best = Infinity;
    for (let i = 1; i < cue.words.length; i++) {
      const d = Math.abs(length(joinWords(cue.words.slice(0, i))) - total / 2);
      if (d < best) [best, at] = [d, i];
    }
    const [l, r] = [cue.words.slice(0, at), cue.words.slice(at)];
    return [
      { ...cue, end: ms(l.at(-1)!.end), text: lines(joinWords(l)), words: l },
      { ...cue, start: ms(r[0].start), text: lines(joinWords(r)), words: r },
    ];
  }
  const flat = cue.text.replace(/\s+/g, ' ').trim();
  const spaced = flat.includes(' ');
  const chars = Array.from(flat);
  if (chars.length < 2 || (!spaced && !UNSPACED.test(flat))) return [cue];
  let at = Math.floor(chars.length / 2);
  if (spaced) {
    const spaces = chars.flatMap((ch, i) => (ch === ' ' ? [i] : []));
    at = spaces.reduce((a, b) => (Math.abs(b - chars.length / 2) < Math.abs(a - chars.length / 2) ? b : a));
  }
  const left = chars.slice(0, at).join('').trim();
  const right = chars.slice(at).join('').trim();
  const mid = ms(cue.start + (cue.end - cue.start) * (length(left) / (length(left) + length(right))));
  return [
    { ...cue, end: mid, text: lines(left), words: undefined },
    { ...cue, start: mid, text: lines(right), words: undefined },
  ];
}

/** length of the longest line, for a gentle warning in the editor */
export const longestLine = (text: string) => Math.max(0, ...text.split('\n').map(length));

import { buildCues, joinWords, SUBTITLE_CUES, TRANSCRIPT_LINES, type Word } from '../subtitle-cues';
import { toSrt, toVtt } from '../subtitles/format';

export interface TranscriptMeta {
  /** model name, e.g. "Whisper base" */
  model: string;
  /** Whisper language code of the speech */
  language: string;
  task: 'transcribe' | 'translate';
  /** length of the audio in seconds */
  duration: number;
}

/**
 * Cleans one window's words and moves them to the file's timeline: drops empty words, fills
 * missing or backwards end times, and drops Whisper's stuck-in-a-loop repeats (the same word
 * more than three times in a row).
 */
export function placeWords(raw: { text: string; timestamp: [number, number | null] }[], offset: number, windowEnd: number): Word[] {
  const out: Word[] = [];
  let run = 0;
  raw.forEach((c, i) => {
    if (!c.text.trim()) return;
    // Whisper hears 30 s (the window plus silent padding) and can time a word past the window's end
    const start = Math.min(offset + Math.max(0, c.timestamp[0]), windowEnd - 0.05);
    const nextStart = raw[i + 1] ? offset + raw[i + 1].timestamp[0] : windowEnd;
    const end = Math.min(windowEnd, Math.max(start + 0.05, c.timestamp[1] === null ? nextStart : offset + c.timestamp[1]));
    const prev = out.at(-1);
    const same = prev && norm(prev.text) === norm(c.text) && norm(c.text) !== '';
    run = same ? run + 1 : 0;
    if (run >= 3) return;
    out.push({ text: c.text, start: round(start), end: round(end) });
  });
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const round = (t: number) => Math.round(t * 100) / 100;

/** 75.4 → "1:15", 3723 → "1:02:03" */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** transcript paragraphs (a sentence or a few, split at long pauses) */
export const transcriptLines = (words: Word[]) => buildCues(words, TRANSCRIPT_LINES).map((c) => ({ start: c.start, end: c.end, text: c.text, words: c.words ?? [] }));

export function toTxt(words: Word[], timestamps: boolean): string {
  return transcriptLines(words)
    .map((l) => (timestamps ? `[${clock(l.start)}] ${l.text}` : l.text))
    .join(timestamps ? '\n' : '\n\n');
}

export const transcriptSrt = (words: Word[]) => toSrt(buildCues(words, SUBTITLE_CUES));
export const transcriptVtt = (words: Word[]) => toVtt(buildCues(words, SUBTITLE_CUES));

export function toJson(words: Word[], meta: TranscriptMeta): string {
  const segments = transcriptLines(words).map((l) => ({
    start: l.start,
    end: l.end,
    text: l.text,
    words: l.words.map((w) => ({ word: w.text.trim(), start: w.start, end: w.end })),
  }));
  return JSON.stringify({ ...meta, text: joinWords(words), segments }, null, 2);
}

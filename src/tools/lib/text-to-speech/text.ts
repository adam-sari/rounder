/*
 * Turning text into speakable pieces: paragraphs (kept for the per-paragraph list and longer
 * pauses), then sentences short enough for Kokoro, which reads at most ~510 phonemes at once
 * and silently cuts the rest. Pure, so it is unit tested.
 */

/** Kokoro's sample rate */
export const SAMPLE_RATE = 24_000;
/** longest piece sent to the model; ~300 characters stays well under its phoneme limit */
export const MAX_CHARS = 300;
/** natural pauses, in seconds at 1× speed */
export const PAUSE = { sentence: 0.2, paragraph: 0.65 } as const;

const ENDS_SENTENCE = /[.!?…:;"”’)\]]$/;

/**
 * Splits on blank lines and line breaks, but re-joins hard-wrapped prose (a line that stops
 * mid-sentence and runs on in lowercase, or a 50+ character line without closing punctuation).
 */
export function splitParagraphs(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let prev = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) {
      if (cur) out.push(cur);
      cur = prev = '';
      continue;
    }
    if (cur && !ENDS_SENTENCE.test(prev) && (/^[a-z]/.test(line) || prev.length >= 50)) cur += ` ${line}`;
    else {
      if (cur) out.push(cur);
      cur = line;
    }
    prev = line;
  }
  if (cur) out.push(cur);
  return out.filter(speakable);
}

/** "***", "---", emoji-only lines: nothing to say (Kokoro gets no phonemes from them) */
const speakable = (s: string) => /[\p{L}\p{N}]/u.test(s);

// a period after these is not the end of a sentence
const ABBREVIATION = /(?:^|[\s(])(?:mr|mrs|ms|dr|prof|sr|jr|st|mt|vs|etc|e\.g|i\.e|inc|ltd|co|fig|approx|dept|est|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|[a-z])\.$/i;

/** Sentences of a paragraph, long ones broken at commas and dashes, then between words */
export function splitSentences(paragraph: string, max = MAX_CHARS): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const m of paragraph.matchAll(/[.!?…]+["'”’)\]]*\s+/g)) {
    const end = m.index + m[0].trimEnd().length;
    const nextChar = paragraph[m.index + m[0].length] ?? '';
    // "e.g. the", "Dr. Smith", "J. K. Rowling", "approx. three": keep going
    if (/^[a-z]/.test(nextChar) || (m[0].trimEnd() === '.' && ABBREVIATION.test(paragraph.slice(start, end)))) continue;
    sentences.push(paragraph.slice(start, end));
    start = m.index + m[0].length;
  }
  sentences.push(paragraph.slice(start));
  return sentences
    .map((s) => s.trim())
    .filter(speakable)
    .flatMap((s) => (s.length > max ? breakLong(s, max) : [s]));
}

/** packs pieces into runs of at most `max` characters */
function pack(pieces: string[], max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && cur.length + 1 + p.length > max) {
      out.push(cur);
      cur = p;
    } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

function breakLong(sentence: string, max: number): string[] {
  return pack(sentence.split(/(?<=[,;:—–])\s+|\s+(?=[—–]\s)/), max).flatMap((clause) => (clause.length > max ? pack(clause.split(/\s+/), max) : [clause]));
}

export interface TextStats {
  chars: number;
  words: number;
  /** spoken length at 1×, roughly 155 words a minute */
  seconds: number;
}

export function textStats(text: string): TextStats {
  const words = text.match(/[\p{L}\p{N}'’-]+/gu)?.length ?? 0;
  return { chars: text.length, words, seconds: (words / 155) * 60 };
}

/** "12 s", "3 min", "1 h 05 min" */
export function formatSpoken(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Joins clips with `gap` seconds of silence after each one (none after the last) */
export function joinAudio(clips: { audio: Float32Array; gap: number }[], rate = SAMPLE_RATE): Float32Array<ArrayBuffer> {
  const gaps = clips.map((c, i) => (i < clips.length - 1 ? Math.round(c.gap * rate) : 0));
  const out = new Float32Array(clips.reduce((n, c, i) => n + c.audio.length + gaps[i], 0));
  let at = 0;
  clips.forEach((c, i) => {
    out.set(c.audio, at);
    at += c.audio.length + gaps[i];
  });
  return out;
}

/** a download name from the first words: "the-quick-brown-fox" */
export function fileStem(text: string): string {
  const words = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const stem = words.slice(0, 5).join('-').slice(0, 40).replace(/-+$/, '');
  return stem || 'speech';
}

export const SAMPLE_TEXT = `Welcome to Rounder's text to speech. Everything you hear is made by a small AI model running right here in your browser, so your words never leave this device.

Paste an article, a script or a whole chapter. Long text is read paragraph by paragraph, and playback starts as soon as the first sentence is ready.`;

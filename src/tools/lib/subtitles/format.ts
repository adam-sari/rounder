/** One subtitle. Times are in seconds; text may span several lines. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

export type SubtitleFormat = 'srt' | 'vtt';

export interface ParseResult {
  cues: Cue[];
  format: SubtitleFormat;
  /** cues dropped because they were empty, unreadable or ended before they started */
  skipped: number;
}

// hours are optional (WebVTT allows mm:ss.ttt) and may run past 99; ms may use , or .
const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d+))?`;
const TIMING = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}`);
const STAMP = new RegExp(String.raw`^\s*${TIME}\s*$`);
const BLANK_LINE = /\n[ \t]*\n/;

const ms = (sec: number) => Math.round(sec * 1000) / 1000;

function seconds(h: string | undefined, m: string, s: string, frac: string | undefined) {
  return ms(Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + (frac ? Number(`0.${frac}`) : 0));
}

/** "01:02:03,500", "1:02.5" or "123:00:00.000" → seconds, or null */
export function parseTimestamp(text: string): number | null {
  const m = STAMP.exec(text);
  return m ? seconds(m[1], m[2], m[3], m[4]) : null;
}

/** 3723.5 → "01:02:03,500" (SRT) or "01:02:03.500" (VTT); hours keep growing past 99 */
export function formatTimestamp(sec: number, separator: ',' | '.' = ','): string {
  const total = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(total % 1000, 3)}`;
}

/** strips the BOM and turns CRLF / CR line endings into LF */
export const normalizeText = (text: string) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '‎', rlm: '‏' };

function decodeEntity(match: string, body: string) {
  if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? match;
  const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
}

/**
 * Removes styling so only the words remain: <i>, <font color>, WebVTT <c.class>, <v Speaker>
 * and inline timestamps, ruby annotations, ASS overrides like {\an8}; decodes &amp; and friends.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .replace(/<rt>[\s\S]*?<\/rt>/gi, '')
    .replace(/<\/?(?:[a-z][^>\n]*|\d[\d:.]*)>/gi, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** Reads SRT or WebVTT, forgiving the usual real-world mess. Cues come back sorted by start. */
export function parseSubtitles(input: string): ParseResult {
  const text = normalizeText(input);
  const format: SubtitleFormat = /^WEBVTT\b/.test(text) ? 'vtt' : 'srt';
  const cues: Cue[] = [];
  let skipped = 0;
  for (const block of text.split(BLANK_LINE)) {
    const lines = block.split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    if (!lines.length) continue;
    const timings = lines.flatMap((l, i) => (l.includes('-->') ? [i] : []));
    if (!timings.length) {
      // VTT headers, NOTE/STYLE/REGION blocks and lone SRT numbers carry no text to show;
      // anything else in an SRT is a cue whose text had a blank line in it
      const prev = cues.at(-1);
      const extra = cleanText(lines.join('\n'));
      if (format === 'srt' && prev && extra && !/^\d+$/.test(extra)) prev.text += `\n${extra}`;
      continue;
    }
    // several timing lines in one block: cues written without the blank line between them
    timings.forEach((t, k) => {
      let stop = timings[k + 1] ?? lines.length;
      if (stop < lines.length && stop - 1 > t && /^\s*\d+\s*$/.test(lines[stop - 1])) stop--;
      const m = TIMING.exec(lines[t]);
      const body = cleanText(lines.slice(t + 1, stop).join('\n'));
      const start = m ? seconds(m[1], m[2], m[3], m[4]) : 0;
      const end = m ? seconds(m[5], m[6], m[7], m[8]) : 0;
      if (!m || !body || end <= start) skipped++;
      else cues.push({ start, end, text: body });
    });
  }
  return { cues: cues.sort((a, b) => a.start - b.start), format, skipped };
}

/** true when the text has at least one "start --> end" timing line */
export const hasTimings = (text: string) => normalizeText(text).split('\n').some((l) => TIMING.test(l));

const textLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
export const isValidCue = (c: Cue) => c.end > c.start && textLines(c.text).length > 0;

export function toSrt(cues: Cue[]): string {
  return cues
    .filter(isValidCue)
    .map((c, i) => `${i + 1}\n${formatTimestamp(c.start, ',')} --> ${formatTimestamp(c.end, ',')}\n${textLines(c.text).join('\n')}\n`)
    .join('\n');
}

const escapeVtt = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toVtt(cues: Cue[]): string {
  const body = cues
    .filter(isValidCue)
    .map((c) => `${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}\n${textLines(c.text).map(escapeVtt).join('\n')}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** Moves every cue by `delta` seconds; cues pushed entirely before 0 are dropped, others clamp at 0. */
export function shiftCues<T extends Cue>(cues: T[], delta: number): T[] {
  return cues.flatMap((c) => {
    const end = ms(c.end + delta);
    return end > 0 ? [{ ...c, start: Math.max(0, ms(c.start + delta)), end }] : [];
  });
}

/**
 * Turns untimed text into cues spread across `duration`, longer lines getting more time.
 * Paragraphs (blank-line separated) become one cue each; without blank lines, every line does.
 */
export function spreadText(text: string, duration: number): Cue[] {
  const body = normalizeText(text).trim();
  if (!body || !(duration > 0)) return [];
  const chunks = (BLANK_LINE.test(body) ? body.split(BLANK_LINE) : body.split('\n')).map((c) => textLines(c).join('\n')).filter(Boolean);
  // very short lines still get long enough to read
  const weights = chunks.map((c) => Math.max(12, c.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return chunks.map((c, i) => {
    const start = t;
    t += (duration * weights[i]) / total;
    return { start: ms(start), end: i === chunks.length - 1 ? ms(duration) : ms(t), text: c };
  });
}

/** text showing at `time`; overlapping cues stack in start order */
export function captionAt(cues: Cue[], time: number): string {
  let out = '';
  for (const c of cues) if (time >= c.start && time < c.end && c.text.trim()) out += (out ? '\n' : '') + c.text.trim();
  return out;
}

/** Subtitle files come in UTF-8, UTF-16 (with a BOM) or old Windows code pages. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

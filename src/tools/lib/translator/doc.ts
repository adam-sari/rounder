/*
 * Turns text (plain or Markdown) into translation units and back. Line structure, whitespace,
 * Markdown syntax (headings, lists, quotes, tables, code, front matter) and inline bits that must
 * not change (code spans, link targets, URLs, HTML tags) stay as they are; only prose is sent.
 * Inline bits inside a sentence travel as {0} placeholders, which MT models copy through (they
 * learn them from software-localization data). When a translation loses one, that unit is
 * translated again as separate fragments around the placeholders.
 */
import { NO_SPACE } from './languages';

/** A sentence (or a few) to translate; `slots` are the protected bits behind {0}, {1}… */
export interface Unit {
  text: string;
  slots: string[];
}
/** text kept verbatim, or the index of a unit */
export type Piece = string | number;
export interface Doc {
  pieces: Piece[];
  units: Unit[];
}

export interface PrepareOptions {
  markdown?: boolean;
  /** longest unit; longer sentences are cut at clause breaks or spaces */
  maxChars: number;
  /** join neighbouring sentences of a paragraph into one unit, up to maxChars */
  group?: boolean;
  /** source language, for sentence boundaries */
  lang?: string;
}

const PH = /\{(\d+)\}/g;
const URL_RE = String.raw`https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]`;
/** our own placeholder syntax when it already appears in the text */
const LITERAL_PH = String.raw`\{\s*\d+\s*\}`;
const PLAIN_PROTECT = new RegExp(`${URL_RE}|${LITERAL_PH}`, 'g');
const MD_PROTECT = new RegExp(
  [
    '`[^`\\n]+`', // code span
    String.raw`!\[[^\]]*\]\([^)]*\)`, // image
    String.raw`\[(?=[^\[\]]*\]\()`, // the "[" opening a link…
    String.raw`\]\([^)]*\)`, // …and its "](target)"
    String.raw`<\/?[a-zA-Z][^>]*>|<https?:[^>]+>`, // HTML tag, autolink
    URL_RE,
    LITERAL_PH,
  ].join('|'),
  'g',
);
/** heading, quote, list and task markers in front of a Markdown line */
const MD_PREFIX = /^\s*(?:>\s?)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;
const MD_KEEP = [/^\s*([-*_])(\s*\1){2,}\s*$/, /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/, /^\s*<[^>]+>\s*$/];
const hasWords = (s: string) => /\p{L}/u.test(s.replace(PH, ''));

function sentences(text: string, lang?: string): string[] {
  if (typeof Intl.Segmenter !== 'function') return [text];
  return Array.from(new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(text), (s) => s.segment);
}

/** Cuts an overlong sentence at the last clause break (or else space) before max */
function cut(s: string, max: number): string[] {
  const out: string[] = [];
  while (s.length > max) {
    const head = s.slice(0, max);
    const clause = Math.max(...[',', ';', ':', '，', '、', '；', '：'].map((c) => head.lastIndexOf(c)));
    const at = clause > max / 3 ? clause : head.lastIndexOf(' ');
    const end = at > max / 3 ? at + 1 : max;
    out.push(s.slice(0, end));
    s = s.slice(end);
  }
  return [...out, s];
}

export function prepare(text: string, o: PrepareOptions): Doc {
  const doc: Doc = { pieces: [], units: [] };
  const keep = (s: string) => s && doc.pieces.push(s);

  /** one stretch of prose: protect inline bits, split into sentences, emit units */
  function prose(s: string) {
    const slots: string[] = [];
    const masked = s.replace(o.markdown ? MD_PROTECT : PLAIN_PROTECT, (m) => `{${slots.push(m) - 1}}`);
    let open = '';
    const flush = () => {
      const body = open.trim();
      const lead = open.length - open.trimStart().length;
      keep(open.slice(0, lead));
      if (hasWords(body)) {
        const local: string[] = [];
        doc.pieces.push(doc.units.push({ text: body.replace(PH, (_, k) => `{${local.push(slots[+k]) - 1}}`), slots: local }) - 1);
      } else keep(body.replace(PH, (_, k) => slots[+k]));
      keep(open.slice(lead + body.length));
      open = '';
    };
    for (const p of sentences(masked, o.lang).flatMap((p) => cut(p, o.maxChars))) {
      if (!o.group || open.length + p.length > o.maxChars) flush();
      open += p;
    }
    flush();
  }

  let fence = '';
  let front = !!o.markdown && /^---\s*$/.test(text.split('\n', 1)[0]);
  text.split('\n').forEach((line, i) => {
    if (i) keep('\n');
    if (!o.markdown) return prose(line);
    if (front) {
      keep(line);
      if (i && /^(---|\.\.\.)\s*$/.test(line)) front = false;
      return;
    }
    const f = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (fence) {
      keep(line);
      if (f && f[0] === fence[0] && f.length >= fence.length && !line.trim().slice(f.length).trim()) fence = '';
      return;
    }
    if (f) {
      fence = f;
      return keep(line);
    }
    if (MD_KEEP.some((re) => re.test(line))) return keep(line);
    if (/^\s*\|/.test(line)) return line.split(/((?<!\\)\|)/).forEach((cell) => (cell === '|' ? keep(cell) : prose(cell)));
    const prefix = line.match(MD_PREFIX)![0];
    keep(prefix);
    prose(line.slice(prefix.length));
  });
  return doc;
}

/** Puts the protected bits back; null when the translation lost or duplicated a placeholder */
export function restore(text: string, slots: string[]): string | null {
  if (!slots.length) return text;
  const seen = Array.from(text.matchAll(/\{\s*(\d+)\s*\}/g), (m) => +m[1]).sort((a, b) => a - b);
  if (seen.length !== slots.length || seen.some((n, i) => n !== i)) return null;
  return text.replace(/\{\s*(\d+)\s*\}/g, (_, k) => slots[+k]);
}

/** The prose between a unit's placeholders, translated one fragment at a time */
function fragments(unit: Unit) {
  const parts = unit.text.split(/\{(\d+)\}/);
  const texts = parts.filter((p, i) => i % 2 === 0 && hasWords(p)).map((p) => p.trim());
  const rebuild = (out: string[]) => {
    let at = 0;
    return parts
      .map((p, i) => {
        if (i % 2) return unit.slots[+p];
        if (!hasWords(p)) return p;
        const lead = p.match(/^\s*/)![0];
        return lead + out[at++] + p.slice(lead.length + p.trim().length);
      })
      .join('');
  };
  return { texts, rebuild };
}

export function assemble(doc: Doc, out: string[], to: string): string {
  return doc.pieces
    .map((p, i) => {
      // "你好。再见。" → "Hello. Goodbye.": sentences that touched in the source need a space in most targets
      if (typeof p === 'number') return (typeof doc.pieces[i - 1] === 'number' && !NO_SPACE.has(to) ? ' ' : '') + out[p];
      // "Hola. Adiós." → "你好。再见。": no space between sentences in Chinese and Japanese
      const between = typeof doc.pieces[i - 1] === 'number' && typeof doc.pieces[i + 1] === 'number';
      return NO_SPACE.has(to) && between && /^ +$/.test(p) ? '' : p;
    })
    .join('');
}

/** Translates every unit with `tr` (which batches, reports progress and can throw to cancel) */
export async function translateDoc(doc: Doc, tr: (texts: string[]) => Promise<string[]>, to: string): Promise<string> {
  const raw = doc.units.length ? await tr(doc.units.map((u) => u.text)) : [];
  const out = raw.map((t, i) => restore(t.trim(), doc.units[i].slots));
  const lost = out.flatMap((t, i) => (t === null ? [i] : []));
  if (lost.length) {
    const jobs = lost.map((i) => fragments(doc.units[i]));
    const flat = await tr(jobs.flatMap((j) => j.texts));
    let at = 0;
    lost.forEach((u, k) => {
      const n = jobs[k].texts.length;
      out[u] = jobs[k].rebuild(flat.slice(at, (at += n)).map((t) => t.trim()));
    });
  }
  return assemble(doc, out as string[], to);
}

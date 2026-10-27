import { clampBox, mergeBoxes, type Box } from './geometry';

/** the parts of getText()'s output that searching uses */
export interface TextItemLike {
  str: string;
  /** pdf.js text matrix in PDF user space */
  transform: number[];
  /** box in points from the page's top-left corner, ascent to descent */
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
  dir?: string;
}

export interface PageTextLike {
  items: TextItemLike[];
  /** unrotated page size in points */
  width: number;
  height: number;
  /** [x1, y1, x2, y2] in PDF user space */
  viewBox: number[];
}

/** A page's text as one searchable string, remembering where each character came from */
export interface PageIndex {
  text: string;
  /** the item each character belongs to; -1 for the spaces and line breaks added between items */
  owner: Int32Array;
  /** the character's position inside its item */
  offset: Int32Array;
}

const isHorizontal = (t: number[]) => Math.abs(t[1]) < 1e-3 * Math.abs(t[0]) && Math.abs(t[2]) < 1e-3 * Math.abs(t[3]);

/** what to put between two pieces of text that pdf.js didn't separate itself */
function gap(a: TextItemLike, b: TextItemLike): string {
  if (/\s$/.test(a.str) || /^\s/.test(b.str)) return '';
  if (!isHorizontal(a.transform) || !isHorizontal(b.transform)) return ' ';
  const h = Math.min(a.height, b.height) || 1;
  if (Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) > 0.5 * h) return '\n';
  const dx = b.x - (a.x + a.width);
  if (dx < -h) return '\n'; // jumped back left: a new column or line
  return dx > 0.15 * h ? ' ' : '';
}

export function buildIndex(items: TextItemLike[]): PageIndex {
  let text = '';
  const owner: number[] = [];
  const offset: number[] = [];
  const add = (s: string, item: number, at = 0) => {
    text += s;
    for (let k = 0; k < s.length; k++) {
      owner.push(item);
      offset.push(item < 0 ? 0 : at + k);
    }
  };
  let prev: TextItemLike | undefined; // the last piece on the current line
  items.forEach((item, i) => {
    if (item.str) {
      if (prev) add(gap(prev, item), -1);
      add(item.str, i);
      prev = item;
    }
    if (item.hasEOL) {
      add('\n', -1);
      prev = undefined;
    }
  });
  return { text, owner: Int32Array.from(owner), offset: Int32Array.from(offset) };
}

/* ---------------- what to look for ---------------- */

export type PresetId = 'email' | 'phone' | 'card' | 'ssn';

const digits = (s: string) => s.replace(/\D/g, '');

/** the Luhn checksum every real payment card number passes */
export function luhn(num: string) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = +num[num.length - 1 - i];
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return num.length > 0 && sum % 10 === 0;
}

interface Pattern {
  source: string;
  flags: string;
  /** extra check on a match, for what a regex can't say cleanly */
  accept?: (match: string) => boolean;
}

export const PRESETS: Record<PresetId, Pattern & { label: string; example: string }> = {
  email: {
    label: 'Email addresses',
    example: 'name@example.com',
    source: String.raw`[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}`,
    flags: 'giu',
  },
  phone: {
    label: 'Phone numbers',
    example: '(555) 123-4567',
    source: String.raw`(?<![\p{L}\p{N}+])(?:\+\d{1,3}[  .-]?)?(?:\(\d{1,4}\)[  .-]?)?\d{2,4}(?:[  .-]?\d{2,4}){1,3}(?![\p{L}\p{N}])`,
    flags: 'gu',
    accept: (m) => {
      const n = digits(m).length;
      if (n < 7 || n > 15) return false;
      // dates and SSNs have the same shape
      return !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|^\d{4}[./-]\d{1,2}[./-]\d{1,2}$|^\d{3}-\d{2}-\d{4}$/.test(m);
    },
  },
  card: {
    label: 'Card numbers',
    example: '4111 1111 1111 1111',
    source: String.raw`(?<![\p{N}])(?:\d[ -]?){12,18}\d(?![\p{N}])`,
    flags: 'gu',
    accept: (m) => luhn(digits(m)),
  },
  ssn: {
    label: 'US SSNs',
    example: '123-45-6789',
    source: String.raw`(?<![\p{N}-])(?!000|666|9\d\d)\d{3}([- ])(?!00)\d{2}\1(?!0000)\d{4}(?![\p{N}])`,
    flags: 'gu',
  },
};

export interface Query {
  text: string;
  regex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  presets: PresetId[];
}

export interface Matcher {
  re: RegExp;
  accept?: (match: string) => boolean;
  preset?: PresetId;
}

// only syntax characters: Unicode-mode regexes reject needless escapes like \-
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = String.raw`[\p{L}\p{N}_]`;

/** Turns the search box and preset toggles into regexes. `error` is shown as-is. */
export function compileQuery(q: Query): { matchers: Matcher[]; error?: string } {
  const matchers: Matcher[] = q.presets.map((id) => ({ re: new RegExp(PRESETS[id].source, PRESETS[id].flags), accept: PRESETS[id].accept, preset: id }));
  const text = q.regex ? q.text : q.text.trim();
  if (!text) return { matchers };
  // plain text: any run of spaces also matches a line break or a gap between text pieces
  let source = q.regex ? text : text.split(/\s+/).map(escape).join(String.raw`\s*`);
  if (q.wholeWord) source = `(?<!${WORD})(?:${source})(?!${WORD})`;
  const flags = `g${q.matchCase ? '' : 'i'}`;
  try {
    matchers.push({ re: new RegExp(source, `${flags}u`) });
  } catch (e) {
    // Unicode mode is stricter about escapes; fall back to classic regex syntax
    try {
      if (q.wholeWord) throw e;
      matchers.push({ re: new RegExp(source, flags) });
    } catch {
      return { matchers, error: `That regular expression isn't valid: ${(e as Error).message.replace(/^Invalid regular expression: /, '')}` };
    }
  }
  return { matchers };
}

export interface Range {
  start: number;
  end: number;
  preset?: PresetId;
}

/**
 * Every match in `text`, trimmed of surrounding whitespace, with overlapping
 * matches (say a phone number that also looks like a card number) merged.
 */
export function findRanges(text: string, matchers: Matcher[], limit = Infinity): Range[] {
  const found: Range[] = [];
  for (const { re, accept, preset } of matchers) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while (found.length < limit && (m = re.exec(text))) {
      if (!m[0]) {
        re.lastIndex++; // an empty match would loop forever
        continue;
      }
      if (accept && !accept(m[0])) continue;
      const lead = m[0].length - m[0].trimStart().length;
      const body = m[0].trim();
      if (body) found.push({ start: m.index + lead, end: m.index + lead + body.length, preset });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Range[] = [];
  for (const r of found) {
    const last = merged.at(-1);
    if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** relative width of a string; character count by default, a canvas measureText is closer */
export type Measure = (s: string) => number;
const byLength: Measure = (s) => s.length;

function norm(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/**
 * The box covering characters [a, b) of one text item, in top-left points.
 * Works for rotated text too (the box then bounds the slanted run).
 * Where only part of an item is covered the edge is padded, since the split
 * point is estimated from character widths: covering a sliver too much beats
 * leaving part of a letter readable.
 */
export function itemSpanBox(item: TextItemLike, a: number, b: number, viewBox: number[], measure: Measure = byLength): Box {
  const t = item.transform;
  const total = measure(item.str) || 1;
  let fa = a <= 0 ? 0 : measure(item.str.slice(0, a)) / total;
  let fb = b >= item.str.length ? 1 : measure(item.str.slice(0, b)) / total;
  if (item.dir === 'rtl') [fa, fb] = [1 - fb, 1 - fa];

  // text space → top-left page space, as in getText(): [t0, -t1, t2, -t3, t4 - x1, y2 - t5]
  const size = Math.hypot(t[2], t[3]) || item.height;
  const [ux, uy] = norm(t[0], -t[1]); // reading direction
  const [vx, vy] = norm(t[2], -t[3]); // "up" for the glyphs
  const ox = t[4] - viewBox[0];
  const oy = viewBox[3] - t[5];
  const ascent = oy - item.y;
  const descent = item.height - ascent;
  const padA = (fa > 0 ? 0.3 : 0.08) * size;
  const padB = (fb < 1 ? 0.3 : 0.08) * size;
  const along = [fa * item.width - padA, fb * item.width + padB];
  const across = [ascent + 0.08 * size, -descent - 0.08 * size];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of along) {
    for (const h of across) {
      xs.push(ox + ux * s + vx * h);
      ys.push(oy + uy * s + vy * h);
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Boxes covering characters [start, end) of the page's indexed text */
export function rangeBoxes(page: PageTextLike, index: PageIndex, start: number, end: number, measure?: Measure): Box[] {
  const boxes: Box[] = [];
  for (let i = start; i < end; ) {
    const o = index.owner[i];
    if (o < 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < end && index.owner[j] === o) j++;
    const item = page.items[o];
    if (item.width > 0) boxes.push(clampBox(itemSpanBox(item, index.offset[i], index.offset[j - 1] + 1, page.viewBox, measure), page.width, page.height));
    i = j;
  }
  return mergeBoxes(boxes.filter((b) => b.width > 0 && b.height > 0));
}

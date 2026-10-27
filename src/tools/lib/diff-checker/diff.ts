import { createTwoFilesPatch, diffArrays } from 'diff';
import { patchNames } from './names';

export type Granularity = 'lines' | 'words' | 'chars';

export interface DiffOptions {
  /** how changes inside a modified line are highlighted */
  granularity: Granularity;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
}

/** A run of lines that is either equal on both sides, or a change replacing a…a+na (original) with b…b+nb (changed) */
export interface Block {
  equal: boolean;
  a: number;
  b: number;
  na: number;
  nb: number;
}

export interface DiffResult {
  linesA: string[];
  linesB: string[];
  blocks: Block[];
  /** highlighted [start, end) character pairs inside changed lines, keyed by line index */
  marksA: Map<number, number[]>;
  marksB: Map<number, number[]>;
  added: number;
  removed: number;
  changes: number;
  /** the texts were too tangled to diff exactly in time, so the match is good but maybe not minimal */
  approximate: boolean;
  /** one side uses Windows (CRLF) line endings and the other doesn't */
  eolDiffers: boolean;
}

const LINE_DIFF_MS = 4000;
const INTRALINE_MS = 150;
/** total time for intraline highlights, so many long unrelated line pairs can't stall the result */
const INTRALINE_BUDGET_MS = 3000;
const INTRALINE_MAX_CHARS = 10_000;
/** below this share of shared text, highlighting individual words is just noise */
const MIN_SIMILARITY = 0.5;

export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lineKey({ ignoreWhitespace, ignoreCase }: DiffOptions) {
  return (line: string) => {
    if (ignoreWhitespace) line = line.replace(/\s+/g, ' ').trim();
    return ignoreCase ? line.toLowerCase() : line;
  };
}

/**
 * Pairs [a, b] of matching line indices, in order. Lines that never occur on the other side
 * can't match, so they're left out before diffing: that keeps very different texts fast.
 */
export function matchLines(keysA: string[], keysB: string[], timeout = LINE_DIFF_MS): { pairs: [number, number][]; approximate: boolean } {
  const ids = new Map<string, number>();
  const intern = (k: string) => {
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = ids.size));
    return id;
  };
  const ia = keysA.map(intern);
  const ib = keysB.map(intern);
  const inA = new Set(ia);
  const inB = new Set(ib);
  const mapA: number[] = [];
  const mapB: number[] = [];
  const fa: number[] = [];
  const fb: number[] = [];
  ia.forEach((id, i) => inB.has(id) && (mapA.push(i), fa.push(id)));
  ib.forEach((id, i) => inA.has(id) && (mapB.push(i), fb.push(id)));

  const changes = diffArrays(fa, fb, { timeout });
  if (!changes) {
    return { pairs: anchoredMatch(fa, fb).map(([x, y]) => [mapA[x], mapB[y]]), approximate: true };
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  for (const c of changes) {
    if (c.added) j += c.count;
    else if (c.removed) i += c.count;
    else for (let k = 0; k < c.count; k++) pairs.push([mapA[i++], mapB[j++]]);
  }
  return { pairs, approximate: false };
}

/**
 * Fallback when the exact diff takes too long: anchor on lines that occur exactly once on each
 * side (patience diff), keep the longest in-order run of them, then grow each gap's matching edges.
 */
function anchoredMatch(a: number[], b: number[]): [number, number][] {
  const countA = new Map<number, number>();
  const countB = new Map<number, number>();
  const posB = new Map<number, number>();
  for (const id of a) countA.set(id, (countA.get(id) ?? 0) + 1);
  b.forEach((id, j) => {
    countB.set(id, (countB.get(id) ?? 0) + 1);
    posB.set(id, j);
  });
  const unique = (id: number) => countA.get(id) === 1 && countB.get(id) === 1;
  const cands = a.flatMap((id, i) => (unique(id) ? [[i, posB.get(id)!] as [number, number]] : []));

  // longest increasing subsequence by position in b
  const tails: number[] = [];
  const prev = new Int32Array(cands.length).fill(-1);
  cands.forEach(([, y], k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cands[tails[mid]][1] < y) lo = mid + 1;
      else hi = mid;
    }
    if (lo) prev[k] = tails[lo - 1];
    tails[lo] = k;
  });
  const anchors: [number, number][] = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) anchors.unshift(cands[k]);

  const pairs: [number, number][] = [];
  let pa = 0;
  let pb = 0;
  for (const [x, y] of [...anchors, [a.length, b.length] as [number, number]]) {
    let s = 0;
    while (pa + s < x && pb + s < y && a[pa + s] === b[pb + s]) pairs.push([pa + s, pb + s++]);
    const tail: [number, number][] = [];
    let e = 1;
    while (x - e >= pa + s && y - e >= pb + s && a[x - e] === b[y - e]) tail.unshift([x - e, y - e++]);
    pairs.push(...tail);
    if (x < a.length) pairs.push([x, y]);
    pa = x + 1;
    pb = y + 1;
  }
  return pairs;
}

export function buildBlocks(pairs: [number, number][], na: number, nb: number): Block[] {
  const blocks: Block[] = [];
  let pa = 0;
  let pb = 0;
  for (const [x, y] of [...pairs, [na, nb]]) {
    if (x > pa || y > pb) blocks.push({ equal: false, a: pa, b: pb, na: x - pa, nb: y - pb });
    if (x === na && y === nb) break;
    const last = blocks[blocks.length - 1];
    if (last?.equal && last.a + last.na === x) {
      last.na++;
      last.nb++;
    } else {
      blocks.push({ equal: true, a: x, b: y, na: 1, nb: 1 });
    }
    pa = x + 1;
    pb = y + 1;
  }
  return blocks;
}

const WORD = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
const WORDISH = /^[\p{L}\p{M}\p{N}_]/u;
const SPACE = /^\s+$/;
/** text with combining marks, emoji, CJK…: split by grapheme so a highlight never cuts a character in half */
const COMPLEX = /[^\u0000-˿]/;
let segmenter: Intl.Segmenter | undefined;

function graphemes(s: string): string[] {
  if (!COMPLEX.test(s) || typeof Intl.Segmenter !== 'function') return Array.from(s);
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(s), (g) => g.segment);
}

function tokenize(s: string, granularity: Granularity): string[] {
  if (granularity === 'chars') return graphemes(s);
  if (!COMPLEX.test(s)) return s.match(WORD) ?? [];
  // runs of word characters and runs of spaces, anything else one grapheme at a time
  const out: string[] = [];
  let prev = 0;
  for (const g of graphemes(s)) {
    const kind = SPACE.test(g) ? 1 : WORDISH.test(g) ? 2 : 0;
    if (kind && kind === prev) out[out.length - 1] += g;
    else out.push(g);
    prev = kind;
  }
  return out;
}

/** Character ranges that changed between two paired lines, or null when the lines are too different to bother */
export function lineMarks(la: string, lb: string, opts: DiffOptions, timeout = INTRALINE_MS): [number[], number[]] | null {
  if (opts.granularity === 'lines' || la.length + lb.length > INTRALINE_MAX_CHARS) return null;
  const key = (t: string) => (opts.ignoreWhitespace && SPACE.test(t) ? ' ' : opts.ignoreCase ? t.toLowerCase() : t);
  const ta = tokenize(la, opts.granularity);
  const tb = tokenize(lb, opts.granularity);
  const changes = diffArrays(ta.map(key), tb.map(key), { timeout });
  if (!changes) return null;

  const marks: [number[], number[]] = [[], []];
  const tokens = [ta, tb];
  const pos = [0, 0];
  const idx = [0, 0];
  let same = 0;
  // moves one side past `count` tokens, optionally marking them
  const step = (side: 0 | 1, count: number, mark: boolean) => {
    const start = pos[side];
    let visible = false;
    for (let k = 0; k < count; k++) {
      const t = tokens[side][idx[side]++];
      pos[side] += t.length;
      if (!SPACE.test(t)) {
        visible = true;
        if (!mark && side === 0) same += t.length;
      }
    }
    if (!mark || (opts.ignoreWhitespace && !visible)) return;
    const m = marks[side];
    if (m.length && m[m.length - 1] === start) m[m.length - 1] = pos[side];
    else m.push(start, pos[side]);
  };
  for (const c of changes) {
    if (c.added) step(1, c.count, true);
    else if (c.removed) step(0, c.count, true);
    else {
      step(0, c.count, false);
      step(1, c.count, false);
    }
  }
  const content = la.replace(/\s+/g, '').length + lb.replace(/\s+/g, '').length;
  return content && (2 * same) / content < MIN_SIMILARITY ? null : marks;
}

export function computeDiff(a: string, b: string, opts: DiffOptions): DiffResult {
  const linesA = splitLines(a);
  const linesB = splitLines(b);
  const key = lineKey(opts);
  const { pairs, approximate } = matchLines(linesA.map(key), linesB.map(key));
  const blocks = buildBlocks(pairs, linesA.length, linesB.length);

  const marksA = new Map<number, number[]>();
  const marksB = new Map<number, number[]>();
  let added = 0;
  let removed = 0;
  let changes = 0;
  const deadline = Date.now() + INTRALINE_BUDGET_MS;
  for (const block of blocks) {
    if (block.equal) continue;
    changes++;
    added += block.nb;
    removed += block.na;
    for (let k = 0; k < Math.min(block.na, block.nb); k++) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const marks = lineMarks(linesA[block.a + k], linesB[block.b + k], opts, Math.min(INTRALINE_MS, left));
      if (!marks) continue;
      marksA.set(block.a + k, marks[0]);
      marksB.set(block.b + k, marks[1]);
    }
  }
  const crlf = (s: string) => s.includes('\r\n');
  const eolDiffers = /[\r\n]/.test(a) && /[\r\n]/.test(b) && crlf(a) !== crlf(b);
  return { linesA, linesB, blocks, marksA, marksB, added, removed, changes, approximate, eolDiffers };
}

/**
 * Unified diff of the exact texts, line endings included: ignore options don't apply, and
 * stripping CRs would give LF hunks that don't apply to a CRLF file
 */
export function unifiedPatch(a: string, b: string, nameA: string, nameB: string): string | undefined {
  const [oldName, newName] = patchNames(nameA, nameB);
  return createTwoFilesPatch(oldName, newName, a, b, undefined, undefined, { context: 3, timeout: 15_000 });
}

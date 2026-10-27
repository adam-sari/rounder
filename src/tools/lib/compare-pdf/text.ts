import { diffLines, diffWordsWithSpace, type ChangeObject } from 'diff';

export type Granularity = 'words' | 'lines';
/** match pages by what's on them (finds inserted and removed pages) or simply 1↔1, 2↔2… */
export type Pairing = 'content' | 'number';

export interface TextOptions {
  granularity: Granularity;
  pairing: Pairing;
}

export interface Part {
  kind: 'same' | 'add' | 'del';
  text: string;
  /** which change on its page this belongs to, -1 for unchanged text */
  hunk: number;
}

export interface PagePair {
  /** 0-based page index in each file, -1 when the page only exists in the other one */
  a: number;
  b: number;
  parts: Part[];
  /** words */
  added: number;
  removed: number;
  changes: number;
}

export interface TextComparison {
  pairs: PagePair[];
  added: number;
  removed: number;
  changes: number;
  /** pairs with at least one change, pages that exist in only one file included */
  changedPages: number;
  /** some pages were too different to diff word by word in time, so lines were compared */
  approximate: boolean;
}

/** below this share of shared words, two pages aren't treated as the same page */
const MATCH = 0.3;
/** how far (in pages, beyond the difference in page count) a page may move and still be matched */
const BAND = 60;
const DIFF_MS = 1500;

/** Text as pdf.js extracts it, minus layout noise: spacing collapsed, lines trimmed, blank lines dropped */
export function normalizePage(text: string) {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export const countWords = (text: string) => text.match(/\S+/g)?.length ?? 0;

/** Each page as a sorted bag of word ids, for quick similarity checks */
export function signatures(pages: string[][]): Int32Array[][] {
  const ids = new Map<string, number>();
  return pages.map((doc) =>
    doc.map((text) => {
      const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      return Int32Array.from(words, (w) => {
        let id = ids.get(w);
        if (id === undefined) ids.set(w, (id = ids.size));
        return id;
      }).sort();
    }),
  );
}

/** Dice coefficient of two sorted word bags: 1 = same words, 0 = nothing in common. Two blank pages match */
export function similarity(x: Int32Array, y: Int32Array) {
  if (!x.length || !y.length) return x.length === y.length ? 1 : 0;
  let i = 0;
  let j = 0;
  let common = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      common++;
      i++;
      j++;
    } else if (x[i] < y[j]) i++;
    else j++;
  }
  return (2 * common) / (x.length + y.length);
}

/**
 * Lines up the pages of two documents, like a diff where each item is a page:
 * the matched pairs maximise total similarity, so an inserted or deleted page
 * doesn't shift everything after it. Returns [a, b] pairs with -1 for a page
 * that only exists on one side.
 */
export function alignPages(a: Int32Array[], b: Int32Array[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const band = Math.abs(n - m) + BAND;
  const score = new Float64Array((n + 1) * w);
  // 0 = pair, 1 = skip a page of a, 2 = skip a page of b
  const move = new Uint8Array((n + 1) * w);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (!i && !j) continue;
      const up = i ? score[(i - 1) * w + j] : -1;
      const left = j ? score[i * w + j - 1] : -1;
      let best = Math.max(up, left);
      let dir = up >= left ? 1 : 2;
      if (i && j && Math.abs(i - j) <= band) {
        const s = similarity(a[i - 1], b[j - 1]);
        const diag = score[(i - 1) * w + j - 1] + s;
        if (s >= MATCH && diag >= best) {
          best = diag;
          dir = 0;
        }
      }
      score[i * w + j] = best;
      move[i * w + j] = dir;
    }
  }
  const matched: [number, number][] = [];
  for (let i = n, j = m; i || j; ) {
    const dir = move[i * w + j];
    if (dir === 0) matched.push([--i, --j]);
    else if (dir === 1) i--;
    else j--;
  }
  matched.reverse();

  // pages left between two matches are paired in order (a heavily rewritten page is still that page);
  // only the surplus counts as inserted or removed
  const out: [number, number][] = [];
  let ia = 0;
  let ib = 0;
  for (const [ma, mb] of [...matched, [n, m]]) {
    out.push(...byNumber(ma - ia, mb - ib).map(([x, y]): [number, number] => [x < 0 ? x : x + ia, y < 0 ? y : y + ib]));
    if (ma < n) out.push([ma, mb]);
    ia = ma + 1;
    ib = mb + 1;
  }
  return out;
}

/** 1↔1, 2↔2…, then the longer document's extra pages */
export function byNumber(n: number, m: number): [number, number][] {
  return Array.from({ length: Math.max(n, m) }, (_, i): [number, number] => [i < n ? i : -1, i < m ? i : -1]);
}

/**
 * Word or line diff of one page. Whitespace-only edits are dropped (they're
 * layout, not content), and nearby edits separated only by spaces form one change.
 */
export function diffPage(a: string, b: string, granularity: Granularity): { parts: Part[]; approximate: boolean } {
  if (a === b) return { parts: a ? [{ kind: 'same', text: a, hunk: -1 }] : [], approximate: false };
  let raw: ChangeObject<string>[] | undefined;
  if (granularity === 'words') raw = diffWordsWithSpace(a, b, { timeout: DIFF_MS });
  const approximate = granularity === 'words' && !raw;
  raw ??= diffLines(a, b, { timeout: DIFF_MS, ignoreNewlineAtEof: true }) ?? [
    { value: a, removed: true, added: false, count: 1 },
    { value: b, removed: false, added: true, count: 1 },
  ];

  const parts: Part[] = [];
  let hunk = -1;
  let open = false;
  const push = (kind: Part['kind'], text: string) => {
    const h = kind === 'same' ? -1 : hunk;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind && last.hunk === h) last.text += text;
    else parts.push({ kind, text, hunk: h });
  };
  for (const c of raw) {
    if (!c.value) continue;
    const blank = !c.value.trim();
    if (!c.added && !c.removed) {
      if (!blank) open = false;
      push('same', c.value);
    } else if (blank) {
      // keep the new layout's whitespace, as unchanged text
      if (c.added) push('same', c.value);
    } else {
      if (!open) hunk++;
      open = true;
      push(c.added ? 'add' : 'del', c.value);
    }
  }
  return { parts, approximate };
}

function onePage(text: string, kind: 'add' | 'del'): PagePair {
  const words = countWords(text);
  return {
    a: -1,
    b: -1,
    parts: text ? [{ kind, text, hunk: 0 }] : [],
    added: kind === 'add' ? words : 0,
    removed: kind === 'del' ? words : 0,
    changes: 1,
  };
}

export function compareTexts(pagesA: string[], pagesB: string[], { granularity, pairing }: TextOptions): TextComparison {
  const A = pagesA.map(normalizePage);
  const B = pagesB.map(normalizePage);
  let order: [number, number][];
  if (pairing === 'number') order = byNumber(A.length, B.length);
  else {
    const [sa, sb] = signatures([A, B]);
    order = alignPages(sa, sb);
  }

  let approximate = false;
  const pairs = order.map(([a, b]): PagePair => {
    if (a < 0) return { ...onePage(B[b], 'add'), b };
    if (b < 0) return { ...onePage(A[a], 'del'), a };
    const d = diffPage(A[a], B[b], granularity);
    approximate ||= d.approximate;
    let added = 0;
    let removed = 0;
    let changes = 0;
    for (const p of d.parts) {
      if (p.kind === 'add') added += countWords(p.text);
      if (p.kind === 'del') removed += countWords(p.text);
      changes = Math.max(changes, p.hunk + 1);
    }
    return { a, b, parts: d.parts, added, removed, changes };
  });

  return {
    pairs,
    added: pairs.reduce((s, p) => s + p.added, 0),
    removed: pairs.reduce((s, p) => s + p.removed, 0),
    changes: pairs.reduce((s, p) => s + p.changes, 0),
    changedPages: pairs.filter((p) => p.changes).length,
    approximate,
  };
}

/** "Page 3", "Page 3 → 4", "New page 5", "Removed page 2" (1-based, for people) */
export function pairLabel({ a, b }: Pick<PagePair, 'a' | 'b'>) {
  if (a < 0) return `New page ${b + 1}`;
  if (b < 0) return `Removed page ${a + 1}`;
  return a === b ? `Page ${a + 1}` : `Page ${a + 1} → ${b + 1}`;
}

/**
 * Shortens long unchanged text to the context around changes: `head`
 * characters after the change before it and `tail` before the next one, cut
 * at word breaks. Returns null when there's little to gain.
 */
export function foldText(text: string, head: number, tail: number) {
  if (text.length <= head + tail + 160) return null;
  const breakBefore = (pos: number) => {
    for (let i = pos; i > pos / 2; i--) if (/\s/.test(text[i])) return i + 1;
    return pos;
  };
  const breakAfter = (pos: number) => {
    for (let i = pos; i < pos + (text.length - pos) / 2; i++) if (/\s/.test(text[i])) return i;
    return pos;
  };
  const h = head ? breakBefore(head) : 0;
  const t = tail ? breakAfter(text.length - tail) : text.length;
  return { head: text.slice(0, h), tail: text.slice(t), hidden: countWords(text.slice(h, t)) };
}

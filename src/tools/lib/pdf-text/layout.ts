/*
 * Turns pdf.js text items into lines and paragraphs in reading order.
 * Columns are found by a recursive XY-cut: split at a vertical gutter when
 * both sides read like text columns, otherwise split at wide horizontal gaps.
 */

/** the parts of a pdf.js text item the layout needs */
export interface RawItem {
  str: string;
  /** text matrix in PDF user space: [a, b, c, d, e, f] */
  transform: number[];
  /** advance along the text direction, in user space */
  width: number;
  dir?: string;
}

/** one paragraph = its lines, in order */
export type Paragraph = string[];

interface Box {
  str: string;
  x0: number;
  x1: number;
  /** baseline, growing downwards */
  base: number;
  top: number;
  bottom: number;
  size: number;
  rtl: boolean;
}

interface Line {
  boxes: Box[];
  top: number;
  bottom: number;
  x0: number;
  x1: number;
  size: number;
  chars: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** the item's quarter turn: 0 = normal, 1 = rotated 90° counter-clockwise, … */
function quarter(t: number[]) {
  return (((Math.round(Math.atan2(t[1], t[0]) / (Math.PI / 2)) % 4) + 4) % 4);
}

function toBox(item: RawItem, q: number): Box {
  const [, , c, d, e, f] = item.transform;
  const size = Math.hypot(c, d) || 1;
  // rotate the page so this orientation reads left to right
  const cos = [1, 0, -1, 0][q];
  const sin = [0, 1, 0, -1][q];
  const along = e * cos + f * sin;
  const base = -(-e * sin + f * cos);
  const width = item.width > 0 ? item.width : item.str.length * size * 0.5;
  return { str: item.str, x0: along, x1: along + width, base, top: base - size * 0.8, bottom: base + size * 0.25, size, rtl: item.dir === 'rtl' };
}

/** Groups boxes into lines (vertical overlap with the line's largest item), top to bottom */
function groupLines(boxes: Box[]): Line[] {
  const lines: Line[] = [];
  let core: Box | undefined;
  for (const b of [...boxes].sort((p, q) => p.base - q.base || p.x0 - q.x0)) {
    const line = lines.at(-1);
    const overlap = core ? Math.min(core.bottom, b.bottom) - Math.max(core.top, b.top) : -1;
    if (line && core && overlap >= 0.5 * Math.min(core.bottom - core.top, b.bottom - b.top)) {
      line.boxes.push(b);
      line.top = Math.min(line.top, b.top);
      line.bottom = Math.max(line.bottom, b.bottom);
      line.x0 = Math.min(line.x0, b.x0);
      line.x1 = Math.max(line.x1, b.x1);
      line.chars += b.str.length;
      if (b.size > core.size) core = b;
    } else {
      lines.push({ boxes: [b], top: b.top, bottom: b.bottom, x0: b.x0, x1: b.x1, size: b.size, chars: b.str.length });
      core = b;
    }
  }
  for (const l of lines) l.size = Math.max(...l.boxes.map((b) => b.size));
  return lines;
}

/** Joins a line's items left to right, adding spaces at word gaps and a tab at wide ones */
function lineText(line: Line): string {
  const rtl = line.boxes.filter((b) => b.rtl).length > line.boxes.length / 2;
  const boxes = [...line.boxes].sort((a, b) => (rtl ? b.x1 - a.x1 : a.x0 - b.x0));
  let out = '';
  let prev: Box | undefined;
  for (const b of boxes) {
    if (prev) {
      const gap = rtl ? prev.x0 - b.x1 : b.x0 - prev.x1;
      const size = Math.min(prev.size, b.size);
      const spaced = /\s$/.test(out) || /^\s/.test(b.str);
      if (gap > 2.5 * size) out = out.trimEnd() + '\t';
      else if (gap > 0.17 * size && !spaced) out += ' ';
    }
    out += prev && /\t$/.test(out) ? b.str.trimStart() : b.str;
    prev = b;
  }
  return out.trim();
}

/** Lines on each side of a gutter must look like running text, not table cells */
function readsLikeColumn(boxes: Box[]) {
  const lines = groupLines(boxes);
  return lines.length >= 2 && median(lines.map((l) => l.chars)) >= 15;
}

/** The widest vertical gutter that splits these boxes into two text columns, or null */
function verticalCut(boxes: Box[], em: number): [Box[], Box[]] | null {
  if (boxes.length < 6) return null;
  const sorted = [...boxes].sort((a, b) => a.x0 - b.x0);
  const gaps: [number, number][] = [];
  let reach = sorted[0].x1;
  for (const b of sorted) {
    if (b.x0 - reach >= Math.max(em, 4)) gaps.push([reach, b.x0]);
    reach = Math.max(reach, b.x1);
  }
  gaps.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
  for (const [g0, g1] of gaps.slice(0, 3)) {
    const left = boxes.filter((b) => b.x1 <= g0);
    const right = boxes.filter((b) => b.x0 >= g1);
    if (readsLikeColumn(left) && readsLikeColumn(right)) return [left, right];
  }
  return null;
}

/** Splits at horizontal gaps clearly wider than the usual space between lines */
function horizontalBands(boxes: Box[], em: number): Box[][] {
  const lines = groupLines(boxes).sort((a, b) => a.top - b.top);
  const gaps: number[] = [];
  let bottom = -Infinity;
  for (const l of lines) {
    if (bottom > -Infinity) gaps.push(Math.max(0, l.top - bottom));
    bottom = Math.max(bottom, l.bottom);
  }
  const threshold = Math.max(0.4 * em, median(gaps) + 0.35 * em);
  const bands: Box[][] = [];
  bottom = -Infinity;
  for (const l of lines) {
    if (!bands.length || l.top - bottom >= threshold) bands.push([]);
    bands.at(-1)!.push(...l.boxes);
    bottom = Math.max(bottom, l.bottom);
  }
  return bands;
}

/** Recursive XY-cut: blocks in reading order */
function blocks(boxes: Box[], em: number): Box[][] {
  const split = verticalCut(boxes, em);
  if (split) return [...blocks(split[0], em), ...blocks(split[1], em)];
  const bands = horizontalBands(boxes, em);
  if (bands.length <= 1) return [boxes];
  // keep neighbouring bands together while they share a gutter, so a two-column
  // body isn't read band by band when both columns happen to break at the same height
  const groups: Box[][] = [];
  let cur = bands[0];
  for (const band of bands.slice(1)) {
    const both = cur.concat(band);
    if (verticalCut(both, em)) cur = both;
    else {
      groups.push(cur);
      cur = band;
    }
  }
  groups.push(cur);
  if (groups.length === 1) return [boxes];
  return groups.flatMap((g) => blocks(g, em));
}

/** Breaks a block's lines into paragraphs at first-line indents and size changes (headings) */
function paragraphs(lines: Line[]): Paragraph[] {
  const left = median(lines.map((l) => l.x0));
  const aligned = lines.filter((l) => Math.abs(l.x0 - left) < l.size * 0.5).length;
  const indents = lines.length >= 3 && aligned >= lines.length / 2;
  const out: Paragraph[] = [];
  let prev: Line | undefined;
  for (const l of lines) {
    const text = lineText(l);
    if (!text) continue;
    const sizeChange = prev && Math.abs(l.size - prev.size) > 0.2 * Math.max(l.size, prev.size);
    const indented = indents && prev && l.x0 - left >= l.size * 0.8 && prev.x0 - left < l.size * 0.5;
    if (!prev || sizeChange || indented) out.push([]);
    out.at(-1)!.push(text);
    prev = l;
  }
  return out;
}

/**
 * Lays out one page: paragraphs of lines in reading order. Text in other
 * orientations (e.g. a rotated margin note) follows the main text.
 */
export function layoutPage(items: RawItem[]): Paragraph[] {
  const byQuarter = new Map<number, RawItem[]>();
  for (const item of items) {
    if (!item.str.trim() || item.transform.length < 6) continue;
    const q = quarter(item.transform);
    const list = byQuarter.get(q);
    if (list) list.push(item);
    else byQuarter.set(q, [item]);
  }
  const chars = (list: RawItem[]) => list.reduce((n, i) => n + i.str.length, 0);
  const groups = [...byQuarter].sort((a, b) => chars(b[1]) - chars(a[1]));
  const out: Paragraph[] = [];
  for (const [q, list] of groups) {
    // fake bold is often the same text drawn twice a hair apart
    const seen = new Set<string>();
    const boxes = list.map((i) => toBox(i, q)).filter((b) => {
      const key = `${b.str}|${Math.round(b.x0)}|${Math.round(b.base)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const em = median(boxes.map((b) => b.size));
    for (const block of blocks(boxes, em)) out.push(...paragraphs(groupLines(block)));
  }
  return out;
}

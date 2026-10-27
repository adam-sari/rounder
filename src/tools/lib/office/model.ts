/*
 * PDF page → document blocks (paragraphs, headings, lists, tables, pictures) for PDF to Word and
 * PDF to Excel. Pure: the browser side (pdf-read.ts) hands in styled text items and picture boxes,
 * OCR hands in recognized words the same way. Coordinates are PDF points with y growing
 * downwards (y = -pdfY), the same space pdf-text/layout.ts lays lines out in.
 */
import { layoutLines, pageLines, type RawItem, type TextLine } from '../pdf-text/layout';

export interface StyledItem extends RawItem {
  /** font family as Word knows it ("Arial", "Times New Roman") */
  font: string;
  bold: boolean;
  italic: boolean;
  /** "#1f4e79", absent for black */
  color?: string;
}

export interface Rect {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

export interface PageInput {
  /** visible page size in points */
  width: number;
  height: number;
  items: StyledItem[];
  /** pictures drawn on the page (already merged where they touch) */
  pictures: Rect[];
  links?: (Rect & { url: string })[];
}

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  /** points */
  size: number;
  font: string;
  color?: string;
  sup?: boolean;
  link?: string;
  /** a tab stop gap before this run (wide gaps such as "Chapter 1 ........ 12") */
  tab?: boolean;
}

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface ParagraphBlock {
  kind: 'paragraph';
  runs: Run[];
  /** largest font size, points */
  size: number;
  align: Align;
  /** left indent from the text area, points */
  indent: number;
  /** extra space above, points */
  before: number;
  /** line pitch ÷ font size (1.2 is single spacing) */
  spacing: number;
  /** marker = the bullet or number as it was typed, kept in case the line turns out to be a heading */
  list?: { type: 'bullet' | 'number'; level: number; start?: number; marker: string };
  /** 1–3 once assignHeadings has run */
  heading?: number;
  rect: Rect;
}

export interface Cell {
  text: string;
  bold: boolean;
}

export interface TableBlock {
  kind: 'table';
  rows: Cell[][];
  /** column widths in points */
  widths: number[];
  /** first row is a bold header */
  header: boolean;
  /** the text size most cells are set in, points */
  size: number;
  rect: Rect;
}

export interface PictureBlock {
  kind: 'picture';
  /** index into the page's pictures */
  index: number;
  rect: Rect;
}

export type Block = ParagraphBlock | TableBlock | PictureBlock;

export interface PageModel {
  width: number;
  height: number;
  blocks: Block[];
  /** text area: the smallest box around everything on the page */
  area: Rect;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

const upright = (it: RawItem) => Math.abs(it.transform[1]) < 1e-3 && Math.abs(it.transform[2]) < 1e-3 && it.transform[0] > 0;
const sizeOf = (it: RawItem) => Math.hypot(it.transform[2], it.transform[3]) || 1;

/** an upright item's box in page space */
function itemRect(it: RawItem): Rect {
  const size = sizeOf(it);
  const x0 = it.transform[4];
  const base = -it.transform[5];
  return { x0, x1: x0 + (it.width > 0 ? it.width : it.str.length * size * 0.5), top: base - size * 0.8, bottom: base + size * 0.25 };
}

const overlapX = (a: Rect, b: Rect) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
const inside = (r: Rect, outer: Rect, slack = 1) => r.x0 >= outer.x0 - slack && r.x1 <= outer.x1 + slack && r.top >= outer.top - slack && r.bottom <= outer.bottom + slack;
const unite = (rs: Rect[]): Rect => ({ x0: Math.min(...rs.map((r) => r.x0)), x1: Math.max(...rs.map((r) => r.x1)), top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) });
const lineRect = (l: TextLine): Rect => ({ x0: l.x0, x1: l.x1, top: l.top, bottom: l.bottom });

/* ---------------- runs ---------------- */

const sameStyle = (a: Run, b: Run) => a.bold === b.bold && a.italic === b.italic && a.font === b.font && a.color === b.color && !!a.sup === !!b.sup && a.link === b.link && Math.abs(a.size - b.size) < 0.6;

/** A line's items as styled runs, spaced the way pdf-text joins them */
export function lineRuns(line: TextLine, items: StyledItem[], links: PageInput['links'] = []): Run[] {
  const runs: Run[] = [];
  const base = median(line.items.map((i) => -items[i].transform[5]));
  let prev: { x1: number; size: number } | undefined;
  for (const i of line.items) {
    const it = items[i];
    const r = itemRect(it);
    const size = sizeOf(it);
    // small and raised: a footnote mark or exponent
    const sup = size < line.size * 0.75 && base - -it.transform[5] > line.size * 0.15;
    let text = it.str;
    let tab = false;
    if (prev) {
      const gap = r.x0 - prev.x1;
      const em = Math.min(prev.size, size);
      const spaced = /\s$/.test(runs.at(-1)?.text ?? '') || /^\s/.test(text);
      if (gap > 2.5 * em) tab = true;
      else if (gap > 0.17 * em && !spaced) text = ' ' + text;
    } else text = text.trimStart();
    const link = links.find((l) => overlapX(l, r) > (r.x1 - r.x0) / 2 && r.top < l.bottom && r.bottom > l.top)?.url;
    const run: Run = { text: tab ? text.trimStart() : text, bold: it.bold, italic: it.italic, size: Math.round(size * 2) / 2, font: it.font, color: it.color, sup: sup || undefined, link, tab: tab || undefined };
    const last = runs.at(-1);
    if (last && !tab && sameStyle(last, run)) last.text += run.text;
    else runs.push(run);
    prev = { x1: r.x1, size };
  }
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
  return runs.filter((r) => r.text || r.tab);
}

/** Joins a paragraph's lines, mending words hyphenated at a line break like pdf-text's unwrap */
export function joinRuns(lines: Run[][]): Run[] {
  const out: Run[] = [];
  for (const line of lines) {
    if (!line.length) continue;
    const last = out.at(-1);
    const first = { ...line[0] };
    if (last) {
      if (/\p{Ll}-$/u.test(last.text) && /^\p{Ll}/u.test(first.text)) last.text = last.text.slice(0, -1);
      else if (!/[\s­]$/.test(last.text)) first.text = ' ' + first.text;
    }
    const rest = [first, ...line.slice(1)];
    for (const r of rest) {
      const prev = out.at(-1);
      if (prev && !r.tab && sameStyle(prev, r)) prev.text += r.text;
      else out.push({ ...r });
    }
  }
  for (const r of out) r.text = r.text.replace(/­/g, '');
  return out;
}

/* ---------------- lists ---------------- */

const BULLET = /^([•◦▪▫‣⁃●○■□►▸➢✓✔\-–—*·])\s+/u;
const NUMBER = /^(\d{1,3}|[a-z]|[ivxlc]{1,5})([.)])\s+/i;

/** "• item" → bullet, "3. item" → number 3; strips the marker off the first run */
export function listMarker(runs: Run[]): ParagraphBlock['list'] | undefined {
  const first = runs[0];
  if (!first) return undefined;
  const b = BULLET.exec(first.text);
  // a lone dash starting a line is usually a bullet; a hyphenated word is not ("-based")
  if (b) {
    first.text = first.text.slice(b[0].length);
    return { type: 'bullet', level: 0, marker: b[0] };
  }
  const n = NUMBER.exec(first.text);
  if (n && /^\d+$/.test(n[1])) {
    first.text = first.text.slice(n[0].length);
    return { type: 'number', level: 0, start: Number(n[1]), marker: n[0] };
  }
  return undefined;
}

/* ---------------- tables ---------------- */

interface Segment extends Rect {
  items: number[];
  text: string;
}

/** Splits a line into cells at gaps wider than about an em */
function segments(line: TextLine, items: StyledItem[]): Segment[] {
  const out: Segment[] = [];
  for (const i of line.items) {
    const r = itemRect(items[i]);
    const size = sizeOf(items[i]);
    const last = out.at(-1);
    if (last && r.x0 - last.x1 < Math.max(size * 1.0, 4)) {
      const glue = r.x0 - last.x1 > 0.17 * size && !/\s$/.test(last.text) && !/^\s/.test(items[i].str) ? ' ' : '';
      last.text += glue + items[i].str;
      last.items.push(i);
      Object.assign(last, unite([last, r]));
    } else out.push({ ...r, items: [i], text: items[i].str });
  }
  for (const s of out) s.text = s.text.trim();
  return out.filter((s) => s.text);
}

interface Region {
  rows: { line: TextLine; segs: Segment[] }[];
  cols: { x0: number; x1: number }[];
}

/** which column each segment falls in, or null when one segment spans two columns (not this table) */
function place(segs: Segment[], cols: Region['cols']): number[] | null {
  const at: number[] = [];
  for (const s of segs) {
    const hits = cols.flatMap((c, k) => (Math.min(s.x1, c.x1) - Math.max(s.x0, c.x0) > -2 ? [k] : []));
    if (hits.length > 1) return null;
    at.push(hits[0] ?? -1);
  }
  // two segments in one column means the columns don't match
  const used = at.filter((k) => k >= 0);
  return new Set(used).size === used.length ? at : null;
}

function addColumns(cols: Region['cols'], segs: Segment[], at: number[]) {
  segs.forEach((s, j) => {
    if (at[j] >= 0) {
      const c = cols[at[j]];
      c.x0 = Math.min(c.x0, s.x0);
      c.x1 = Math.max(c.x1, s.x1);
    } else cols.push({ x0: s.x0, x1: s.x1 });
  });
  cols.sort((a, b) => a.x0 - b.x0);
}

/** A region reads like a table, not like two columns of prose */
function tableLike(region: Region): boolean {
  const multi = region.rows.filter((r) => r.segs.length >= 2);
  if (multi.length < 2 || region.cols.length < 2) return false;
  const cells = multi.flatMap((r) => r.segs.map((s) => s.text.length));
  return region.cols.length >= 3 ? median(cells) <= 40 : median(cells) <= 24;
}

/** Turns a region into rows of cells; lines that only continue some cells (wrapped text) join the row above */
function toTable(region: Region, items: StyledItem[], areaRight: number): TableBlock {
  const { cols } = region;
  const pitches = region.rows.slice(1).map((r, k) => r.line.top - region.rows[k].line.bottom);
  const usual = median(pitches);
  const rows: Cell[][] = [];
  let prevFilled: Set<number> | undefined;
  // columns grew while rows were added, so place again, falling back to the nearest column
  const nearest = (s: Segment) => cols.reduce((best, c, k) => (Math.abs((c.x0 + c.x1) / 2 - (s.x0 + s.x1) / 2) < Math.abs((cols[best].x0 + cols[best].x1) / 2 - (s.x0 + s.x1) / 2) ? k : best), 0);
  region.rows.forEach(({ line, segs }, k) => {
    const at = (place(segs, cols) ?? segs.map(nearest)).map((c, j) => (c >= 0 ? c : nearest(segs[j])));
    const filled = new Set(at);
    const gap = k ? line.top - region.rows[k - 1].line.bottom : Infinity;
    const continues = prevFilled && gap < usual * 0.6 && filled.size < prevFilled.size && [...filled].every((c) => prevFilled!.has(c));
    const bold = (s: Segment) => s.items.every((i) => items[i].bold);
    if (continues) {
      const row = rows.at(-1)!;
      segs.forEach((s, j) => (row[at[j]] = { text: `${row[at[j]].text} ${s.text}`.trim(), bold: row[at[j]].bold && bold(s) }));
      return;
    }
    const row: Cell[] = cols.map(() => ({ text: '', bold: false }));
    segs.forEach((s, j) => (row[at[j]] = row[at[j]].text ? { text: `${row[at[j]].text} ${s.text}`, bold: row[at[j]].bold && bold(s) } : { text: s.text, bold: bold(s) }));
    rows.push(row);
    prevFilled = filled;
  });
  // each column reaches halfway to the next
  const edges = cols.map((c, k) => (k ? (cols[k - 1].x1 + c.x0) / 2 : c.x0));
  edges.push(Math.max(cols.at(-1)!.x1, Math.min(areaRight, cols.at(-1)!.x1 + 12)));
  const widths = cols.map((_, k) => Math.max(12, edges[k + 1] - edges[k]));
  const header = rows.length > 1 && rows[0].every((c) => !c.text || c.bold) && rows[0].some((c) => c.text) && !rows.slice(1).every((r) => r.every((c) => !c.text || c.bold));
  const size = median(region.rows.flatMap((r) => r.line.items.map((i) => sizeOf(items[i]))));
  return { kind: 'table', rows, widths, header, size: Math.round(size * 2) / 2, rect: unite(region.rows.map((r) => lineRect(r.line))) };
}

/** Finds tables among the page's lines: runs of lines whose cells line up in the same columns */
export function findTables(lines: TextLine[], items: StyledItem[], areaRight = Infinity): TableBlock[] {
  const tables: TableBlock[] = [];
  let region: Region | null = null;
  const close = () => {
    // trailing single-cell lines aren't part of it
    while (region?.rows.length && region.rows.at(-1)!.segs.length < 2) region.rows.pop();
    if (region && tableLike(region)) tables.push(toTable(region, items, areaRight));
    region = null;
  };
  for (const line of lines) {
    const segs = segments(line, items);
    const size = line.size;
    if (region) {
      const r: Region = region;
      const last = r.rows.at(-1)!;
      const tooFar = line.top - last.line.bottom > size * 2.2;
      const at = place(segs, r.cols);
      const width = r.cols.at(-1)!.x1 - r.cols[0].x0;
      // one wide segment (a caption or the next paragraph) ends the table
      const wide = segs.length === 1 && segs[0].x1 - segs[0].x0 > width * 0.6;
      if (!tooFar && at && !wide && (segs.length >= 2 || last.segs.length >= 2)) {
        addColumns(r.cols, segs, at);
        r.rows.push({ line, segs });
        continue;
      }
      close();
    }
    if (segs.length >= 2) {
      const cols: Region['cols'] = [];
      addColumns(cols, segs, segs.map(() => -1));
      region = { rows: [{ line, segs }], cols };
    }
  }
  close();
  return tables;
}

/* ---------------- paragraphs ---------------- */

function alignOf(lines: TextLine[], area: Rect): Align {
  const w = area.x1 - area.x0;
  const centered = (l: TextLine) => Math.abs(l.x0 - area.x0 - (area.x1 - l.x1)) < w * 0.04 && l.x0 - area.x0 > w * 0.06;
  if (lines.every(centered)) return 'center';
  if (lines.length === 1) {
    const l = lines[0];
    return area.x1 - l.x1 < w * 0.02 && l.x0 - area.x0 > w * 0.5 && l.x1 - l.x0 < w * 0.35 ? 'right' : 'left';
  }
  const body = lines.slice(0, -1);
  const right = Math.max(...body.map((l) => l.x1));
  const left = Math.min(...lines.map((l) => l.x0));
  if (body.length >= 2 && body.every((l) => right - l.x1 < 1.5) && lines.at(-1)!.x1 < right - 4) return 'justify';
  if (lines.every((l) => right - l.x1 < 1.5) && lines.some((l) => l.x0 - left > l.size)) return 'right';
  return 'left';
}

const startsItem = (text: string) => BULLET.test(text) || /^\d{1,3}[.)]\s+\S/.test(text);
/** the line is set entirely in bold (or italic): a lead-in line, caption or label */
const lineStyle = (l: TextLine, items: StyledItem[]) => {
  const its = l.items.map((i) => items[i]).filter((it) => it.str.trim());
  return `${its.every((it) => it.bold) ? 'b' : ''}${its.every((it) => it.italic) ? 'i' : ''}`;
};

/**
 * Splits layout paragraphs further where Word would see new ones: a line starting with a bullet or
 * number, a whole line switching to or from bold/italic, and a gap of several lines.
 */
export function splitParagraphs(paragraphs: TextLine[][], items: StyledItem[]): TextLine[][] {
  const out: TextLine[][] = [];
  for (const lines of paragraphs) {
    let cur: TextLine[] = [];
    lines.forEach((l, k) => {
      const prev = lines[k - 1];
      const cut = prev && (startsItem(l.text) || lineStyle(l, items) !== lineStyle(prev, items) || l.top - prev.bottom > l.size * 2.5);
      if (cut && cur.length) {
        out.push(cur);
        cur = [];
      }
      cur.push(l);
    });
    if (cur.length) out.push(cur);
  }
  return out;
}

/** Builds one page: paragraphs in reading order, with tables and pictures where they sit */
export function buildPage(page: PageInput): PageModel {
  const { items, pictures } = page;
  const all = items.flatMap((it, i) => (it.str.trim() ? [i] : []));
  const rects = all.filter((i) => upright(items[i])).map((i) => itemRect(items[i]));
  const area = rects.length ? unite([...rects, ...pictures]) : pictures.length ? unite(pictures) : { x0: 0, x1: page.width, top: -page.height, bottom: 0 };

  // a picture covering most of the page with text on it is a background (a scan with OCR, a letterhead): text wins
  const pageArea = page.width * page.height;
  const figures = pictures.flatMap((p, index) => {
    const big = (p.x1 - p.x0) * (p.bottom - p.top) > pageArea * 0.5;
    const covered = rects.filter((r) => inside(r, p)).length;
    return big && covered >= 5 ? [] : [{ index, rect: p }];
  });
  // text inside a figure is part of it (chart labels): it's in the picture already
  const inFigure = new Set(all.filter((i) => upright(items[i]) && figures.some((f) => inside(itemRect(items[i]), f.rect))));

  const tables = findTables(pageLines(items, (i) => !inFigure.has(i)), items, area.x1);
  const inTable = new Set<number>();
  for (const t of tables) for (const i of all) if (upright(items[i]) && inside(itemRect(items[i]), t.rect, 2)) inTable.add(i);

  const paragraphs: ParagraphBlock[] = [];
  for (const lines of splitParagraphs(layoutLines(items, (i) => !inFigure.has(i) && !inTable.has(i)), items)) {
    const runs = joinRuns(lines.map((l) => lineRuns(l, items, page.links)));
    if (!runs.length) continue;
    const size = Math.max(...lines.map((l) => l.size));
    const list = listMarker(runs);
    const pitch = lines.length > 1 ? median(lines.slice(1).map((l, k) => l.top - lines[k].top)) : size * 1.2;
    const left = Math.min(...lines.map((l) => l.x0));
    const indent = left - area.x0;
    const rect = unite(lines.map(lineRect));
    const align = alignOf(lines, area);
    paragraphs.push({
      kind: 'paragraph',
      runs: runs.filter((r) => r.text || r.tab),
      size,
      align,
      // right-hand columns and centered lines aren't indents
      indent: align !== 'center' && align !== 'right' && indent > 0 && indent < (area.x1 - area.x0) * 0.3 ? Math.round(indent) : 0,
      before: 0,
      spacing: Math.round((pitch / size) * 100) / 100,
      list,
      rect,
    });
  }
  // nested lists: deeper by how far the marker sits right of the list's first one
  for (let k = 0; k < paragraphs.length; k++) {
    if (!paragraphs[k].list || paragraphs[k - 1]?.list) continue;
    let end = k;
    // a size change ends the list ("2. Results" in 16 pt after an 11 pt list is a heading)
    while (paragraphs[end + 1]?.list && Math.abs(paragraphs[end + 1].size - paragraphs[k].size) <= paragraphs[k].size * 0.15) end++;
    const base = Math.min(...paragraphs.slice(k, end + 1).map((p) => p.rect.x0));
    for (const p of paragraphs.slice(k, end + 1)) p.list!.level = Math.min(2, Math.round((p.rect.x0 - base) / (p.size * 1.5)));
  }

  const blocks: Block[] = [...paragraphs];
  const extras: (TableBlock | PictureBlock)[] = [...tables, ...figures.map((f): PictureBlock => ({ kind: 'picture', index: f.index, rect: f.rect }))];
  for (const x of extras.sort((a, b) => a.rect.top - b.rect.top)) {
    // before the first text below it in the same column, else after the last text above it
    const below = blocks.findIndex((b) => b.rect.top >= x.rect.top - 1 && overlapX(b.rect, x.rect) > 0);
    if (below >= 0) {
      blocks.splice(below, 0, x);
      continue;
    }
    let above = -1;
    blocks.forEach((b, k) => b.rect.top < x.rect.top && overlapX(b.rect, x.rect) > 0 && (above = k));
    blocks.splice(above >= 0 ? above + 1 : blocks.length, 0, x);
  }
  // space above a paragraph: the gap to whatever is above it in the flow
  blocks.forEach((b, k) => {
    const above = blocks[k - 1];
    if (b.kind === 'paragraph' && above) b.before = Math.round(Math.max(0, Math.min(36, b.rect.top - above.rect.bottom - b.size * 0.3)));
  });
  return { width: page.width, height: page.height, blocks, area };
}

/* ---------------- document level ---------------- */

/** the body font size: the size most characters are set in */
export function bodySize(pages: PageModel[]): number {
  const chars = new Map<number, number>();
  for (const p of pages)
    for (const b of p.blocks)
      if (b.kind === 'paragraph') for (const r of b.runs) chars.set(r.size, (chars.get(r.size) ?? 0) + r.text.length);
  return [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
}

const plainText = (p: ParagraphBlock) => p.runs.map((r) => r.text).join('');

/**
 * Marks headings: short paragraphs set clearly larger than the body text, or bold body-size
 * lines standing on their own. Levels follow the sizes used (largest = 1), at most three.
 */
export function assignHeadings(pages: PageModel[]): void {
  const body = bodySize(pages);
  const candidates: ParagraphBlock[] = [];
  for (const p of pages)
    for (const b of p.blocks) {
      if (b.kind !== 'paragraph' || b.list?.type === 'bullet') continue;
      const text = plainText(b).trim();
      const bold = b.runs.every((r) => r.bold || !r.text.trim());
      const oneLine = b.rect.bottom - b.rect.top < b.size * 1.6;
      const short = text.length > 0 && text.length <= 120 && b.rect.bottom - b.rect.top < b.size * 3.6;
      // clearly bigger, and bold unless much bigger; or a bold line of body text standing alone
      const big = b.size >= body * 1.15 && (bold || b.size >= body * 1.3);
      const boldLine = bold && text.length <= 80 && !/[.:,;]$/.test(text) && oneLine;
      // a numbered list item only when it's big ("1. Summary" in 16 pt)
      if (b.list && !(big && oneLine)) continue;
      if (short && (big || boldLine) && /\p{L}/u.test(text)) candidates.push(b);
    }
  const sizes = [...new Set(candidates.map((b) => Math.round(b.size)))].sort((a, b) => b - a);
  for (const b of candidates) {
    b.heading = Math.min(3, sizes.indexOf(Math.round(b.size)) + 1);
    // headings keep their numbers as typed
    if (b.list) {
      b.runs[0] = { ...b.runs[0], text: b.list.marker + b.runs[0].text };
      b.list = undefined;
    }
  }
}

/** Every table on every page, for PDF to Excel */
export const allTables = (pages: PageModel[]) => pages.flatMap((p, page) => p.blocks.flatMap((b) => (b.kind === 'table' ? [{ page, table: b }] : [])));

/**
 * Every line of a page as a row of cells, for "all text" exports: rows of the tables found, and
 * the other lines cut into cells at wide gaps, from the left.
 */
export function pageGrid(page: PageInput, model: PageModel): string[][] {
  const tables = model.blocks.filter((b): b is TableBlock => b.kind === 'table');
  const done = new Set<TableBlock>();
  const rows: string[][] = [];
  for (const line of pageLines(page.items)) {
    const table = tables.find((t) => line.top >= t.rect.top - 1 && line.bottom <= t.rect.bottom + 1 && overlapX(lineRect(line), t.rect) > 0);
    if (table) {
      if (!done.has(table)) rows.push(...table.rows.map((r) => r.map((c) => c.text)));
      done.add(table);
    } else rows.push(segments(line, page.items).map((s) => s.text));
  }
  return rows;
}

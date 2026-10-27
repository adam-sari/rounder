/**
 * Lays the document model out on pages: word wrapping with mixed styles,
 * lists, quotes, code blocks, tables and images, then pagination with
 * keep-with-next headings, no single-line orphans or widows, and table
 * headers repeated on every page. Pure: fonts come in as a Measure function,
 * and the result is a display list that pdf.ts draws with pdf-lib and the
 * preview draws as SVG. Coordinates are points from the page's top-left.
 */
import { isWinAnsi, PAGE_SIZES } from '@/engines/pdf/lib';
import type { Align, Block, InlineImage, ListItem, Run } from './model';
import { fontKey, marginPt, notoKey, pageLabel, THEMES, type Family, type FontKey, type PageOptions, type Theme } from './themes';

/** advance width of text at size 1 */
export type Measure = (text: string, font: FontKey) => number;

export type Item =
  /** y is the baseline */
  | { k: 'text'; x: number; y: number; w: number; text: string; font: FontKey; size: number; color: string; skew?: boolean }
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lw?: number; r?: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; lw: number; color: string }
  | { k: 'img'; x: number; y: number; w: number; h: number; src: string }
  | { k: 'link'; x: number; y: number; w: number; h: number; href: string };

export interface Page {
  items: Item[];
}

export interface Layout {
  width: number;
  height: number;
  pages: Page[];
}

/** natural size in CSS pixels */
export interface ImageSize {
  w: number;
  h: number;
}

export interface Atom {
  text: string;
  font: FontKey;
  /** slanted Noto standing in for italics */
  skew: boolean;
  size: number;
  w: number;
  color: string;
  run: Run;
  space?: boolean;
  br?: boolean;
  /** inline image: drawn standing on the baseline, h tall */
  img?: string;
  h?: number;
  /** no line break allowed between this atom and the previous one */
  join?: boolean;
}

export interface Line {
  atoms: Atom[];
  w: number;
}

export interface TextStyle {
  family: Family;
  size: number;
  /** line height, × size */
  lead: number;
  color: string;
  b?: boolean;
  i?: boolean;
  align?: Align;
}

const EPS = 0.01;
/** CSS pixels → points */
const PX = 0.75;

const CJK = '\\u2E80-\\u2FFF\\u3000-\\u303F\\u3040-\\u30FF\\u3100-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF\\uFF00-\\uFFEF';
const TOKENS = new RegExp(`[ \\t\\n\\r\\f]+|[${CJK}]|[^ \\t\\n\\r\\f${CJK}]+`, 'g');
const IS_CJK = new RegExp(`^[${CJK}]$`);
// a line may break after a hyphen inside a word, like browsers do: "state-of-|the-|art"
const HYPHEN = /(?<=[^\s-]-)(?=[^\s-])/;

/* ---------------- line breaking ---------------- */

/**
 * Greedy line breaking. Lines break at spaces, after hyphens, between CJK
 * characters and at forced breaks; a word wider than the line is split
 * between characters. Spaces at line ends are dropped.
 */
export function breakLines(atoms: Atom[], width: number, measure: Measure): Line[] {
  const lines: Line[] = [];
  let line: Atom[] = [];
  let lineW = 0;
  let spaces: Atom[] = [];
  const flush = () => {
    lines.push({ atoms: line, w: lineW });
    line = [];
    lineW = 0;
    spaces = [];
  };
  let i = 0;
  while (i < atoms.length) {
    const a = atoms[i];
    if (a.br) {
      flush();
      i++;
      continue;
    }
    if (a.space) {
      if (line.length) spaces.push(a);
      i++;
      continue;
    }
    let j = i + 1;
    let w = a.w;
    while (j < atoms.length && atoms[j].join) w += atoms[j++].w;
    const word = atoms.slice(i, j);
    i = j;
    const spaceW = spaces.reduce((s, x) => s + x.w, 0);
    if (line.length && lineW + spaceW + w > width + EPS) flush();
    else if (line.length) {
      line.push(...spaces);
      lineW += spaceW;
    }
    spaces = [];
    if (!line.length && w > width + EPS) {
      const pieces = splitWord(word, width, measure);
      const last = pieces.pop()!;
      for (const p of pieces) lines.push({ atoms: p, w: sum(p) });
      line = last;
      lineW = sum(last);
    } else {
      line.push(...word);
      lineW += w;
    }
  }
  if (line.length || !lines.length) flush();
  return lines;
}

/** Splits atoms between characters into pieces no wider than width (each piece holds at least one character) */
export function splitWord(word: Atom[], width: number, measure: Measure): Atom[][] {
  const pieces: Atom[][] = [];
  let piece: Atom[] = [];
  let pieceW = 0;
  for (const a of word) {
    if (a.img || !a.text) {
      if (piece.length && pieceW + a.w > width + EPS) {
        pieces.push(piece);
        piece = [];
        pieceW = 0;
      }
      piece.push(a);
      pieceW += a.w;
      continue;
    }
    let chunk = '';
    let chunkW = 0;
    for (const ch of a.text) {
      const cw = measure(ch, a.font) * a.size;
      if (pieceW + chunkW + cw > width + EPS && (piece.length || chunk)) {
        if (chunk) piece.push({ ...a, text: chunk, w: chunkW });
        pieces.push(piece);
        piece = [];
        pieceW = 0;
        chunk = '';
        chunkW = 0;
      }
      chunk += ch;
      chunkW += cw;
    }
    if (chunk) {
      piece.push({ ...a, text: chunk, w: chunkW, join: piece.length > 0 });
      pieceW += chunkW;
    }
  }
  pieces.push(piece);
  return pieces;
}

const sum = (atoms: Atom[]) => atoms.reduce((s, a) => s + a.w, 0);

/** The widest run of glued atoms: the narrowest a table column can get without splitting words */
export function longestWord(atoms: Atom[]): number {
  let best = 0;
  let cur = 0;
  for (const a of atoms) {
    if (a.space || a.br) cur = 0;
    else cur = a.join ? cur + a.w : a.w;
    best = Math.max(best, cur);
  }
  return best;
}

/** Splits text into runs that the standard fonts can draw and runs that need Noto */
export function splitByFont(text: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let ansi: boolean | null = null;
  for (const ch of text) {
    const a = isWinAnsi(ch);
    if (cur && a !== ansi) {
      parts.push(cur);
      cur = '';
    }
    cur += ch;
    ansi = a;
  }
  if (cur) parts.push(cur);
  return parts;
}

/* ---------------- flowing blocks into boxes ---------------- */

/** An unbreakable slice of the document, usually one line */
interface Box {
  h: number;
  /** space above, dropped at the top of a page */
  gap: number;
  /** y relative to the box top */
  items: Item[];
  /** keep on the same page as the next box */
  keep?: boolean;
  /** enclosing containers, outermost first */
  cs: number[];
  /** baseline of the first line, for list markers */
  base?: number;
}

/** A background or bar drawn behind a run of boxes, split where the page breaks */
interface Container {
  x: number;
  w: number;
  padTop: number;
  padBottom: number;
  fill?: string;
  stroke?: string;
  r?: number;
  /** a table's header row, repeated at the top of each continuation page */
  header?: Box;
}

interface Ctx {
  color: string;
  i: boolean;
  depth: number;
}

type Content = { h: number; base: number; items: Item[] };

class Flow {
  boxes: Box[] = [];
  containers: Container[] = [];
  private pending = 0;
  private cs: number[] = [];

  constructor(
    private t: Theme,
    private m: Measure,
    private images: Record<string, ImageSize>,
    /** tallest an image may be: most of the page's content height */
    private maxImgH: number,
  ) {}

  private emit(box: Omit<Box, 'gap' | 'cs'>) {
    this.boxes.push({ ...box, gap: this.pending, cs: this.cs });
    this.pending = 0;
  }

  /** CSS-style collapsing margins: the gap between blocks is the larger of the two */
  private space(margin: number) {
    this.pending = Math.max(this.pending, margin);
  }

  private open(c: Container) {
    this.cs = [...this.cs, this.containers.push(c) - 1];
  }

  private close() {
    this.cs = this.cs.slice(0, -1);
  }

  private body(ctx: Ctx): TextStyle {
    return { family: this.t.body, size: this.t.size, lead: this.t.lead, color: ctx.color, i: ctx.i };
  }

  blocks(blocks: Block[], x: number, w: number, ctx: Ctx) {
    const gap = this.t.size * 0.8;
    for (const b of blocks) {
      switch (b.t) {
        case 'p':
          this.para(b.runs, x, w, this.body(ctx), b.tight ? 0 : gap);
          break;
        case 'h': {
          const hs = this.t.h[Math.min(6, Math.max(1, b.level)) - 1];
          const size = this.t.size * hs.scale;
          const style = { family: this.t.heading, size, lead: 1.25, color: this.t.headingColor, b: hs.bold, i: hs.italic || ctx.i };
          this.space(hs.mt * this.t.size);
          const before = this.boxes.length;
          this.para(b.runs, x, w, style, hs.mb * this.t.size, true);
          const last = this.boxes.at(-1);
          if (hs.rule && last && this.boxes.length > before) {
            last.h += size * 0.3;
            last.items.push({ k: 'line', x1: x, y1: last.h - 0.4, x2: x + w, y2: last.h - 0.4, lw: 0.8, color: this.t.rule });
          }
          break;
        }
        case 'code':
          this.code(b.text, x, w, gap);
          break;
        case 'list':
          this.list(b.ordered, b.start, b.items, x, w, ctx, gap);
          break;
        case 'quote': {
          const bar = 3;
          const indent = bar + this.t.size * 1.1;
          this.open({ x, w: bar, padTop: 2, padBottom: 2, fill: this.t.quoteBar });
          this.blocks(b.blocks, x + indent, w - indent, { ...ctx, color: this.t.muted, i: this.t.quoteItalic || ctx.i });
          this.close();
          this.space(gap);
          break;
        }
        case 'hr':
          this.space(this.t.size * 1.2);
          this.emit({ h: 1, items: [{ k: 'line', x1: x, y1: 0.5, x2: x + w, y2: 0.5, lw: 0.8, color: this.t.rule }] });
          this.space(this.t.size * 1.2);
          break;
        case 'img':
          this.image(b, b.href, x, w, ctx);
          this.space(gap);
          break;
        case 'table':
          this.table(b.align, b.head, b.rows, x, w, ctx);
          this.space(gap);
          break;
      }
    }
  }

  /** Paragraph-like text: one box per line, without single-line orphans or widows */
  private para(runs: Run[], x: number, w: number, style: TextStyle, mb: number, keepAll = false) {
    const atoms = this.atoms(runs, style, w);
    if (!atoms.length) return;
    const lines = breakLines(atoms, w, this.m);
    const n = lines.length;
    lines.forEach((line, k) => {
      this.emit({ ...this.lineBox(line, x, w, style), keep: keepAll || (n > 1 && (k === 0 || k === n - 2)) });
    });
    this.space(mb);
  }

  /** Turns runs into measured atoms: words, spaces, CJK characters, inline images */
  atoms(runs: Run[], style: TextStyle, maxW: number): Atom[] {
    const out: Atom[] = [];
    let glue = false;
    for (const run of runs) {
      const family = run.code ? 'mono' : style.family;
      const b = !!(style.b || run.b);
      const i = !!(style.i || run.i);
      const size = run.code ? style.size * this.t.codeScale : style.size;
      const color = run.href ? this.t.accent : style.color;
      if (run.br) {
        out.push({ text: '', font: fontKey(family), skew: false, size, w: 0, color, run, br: true });
        glue = false;
        continue;
      }
      if (run.img) {
        out.push(this.imageAtom(run, run.img, style, maxW));
        glue = false;
        continue;
      }
      for (const [tok] of run.text.matchAll(TOKENS)) {
        if (/^[ \t\n\r\f]/.test(tok)) {
          const font = fontKey(family, b, i);
          out.push({ text: ' ', font, skew: false, size, w: this.m(' ', font) * size, color, run, space: true });
          glue = false;
          continue;
        }
        const cjk = IS_CJK.test(tok);
        tok.split(HYPHEN).forEach((piece, k) => {
          const ansi = isWinAnsi(piece);
          const font = ansi ? fontKey(family, b, i) : notoKey(b);
          out.push({ text: piece, font, skew: !ansi && i, size, w: this.m(piece, font) * size, color, run, join: glue && k === 0 && !cjk });
          glue = !cjk;
        });
      }
    }
    return out;
  }

  private imageAtom(run: Run, img: InlineImage, style: TextStyle, maxW: number): Atom {
    const info = this.images[img.src];
    let font = fontKey(style.family, false, true);
    if (!info) {
      // no image to draw: show its description instead
      const text = img.alt ? `[${img.alt}]` : '[image]';
      const ansi = isWinAnsi(text);
      if (!ansi) font = notoKey();
      return { text, font, skew: !ansi, size: style.size, w: this.m(text, font) * style.size, color: this.t.muted, run };
    }
    const { w, h } = imageBox(img, info, maxW, this.maxImgH);
    return { text: '', font, skew: false, size: style.size, w, h, img: img.src, color: style.color, run };
  }

  /** One line's height, baseline and items; images taller than the text push the baseline down */
  private lineBox(line: Line, x: number, w: number, style: TextStyle): Content {
    let h = style.size * style.lead;
    let base = h / 2 + style.size * 0.3;
    const imgH = Math.max(0, ...line.atoms.map((a) => a.h ?? 0));
    if (imgH + 1 > base) {
      const extra = imgH + 1 - base;
      base += extra;
      h += extra;
    }
    const off = style.align === 'center' ? (w - line.w) / 2 : style.align === 'right' ? w - line.w : 0;
    return { h, base, items: this.place(line.atoms, x + Math.max(0, off), base, h) };
  }

  /** Positions a line's atoms as text items, plus code backgrounds, links, underlines and strikes */
  private place(atoms: Atom[], x0: number, base: number, lineH: number): Item[] {
    const xs: number[] = [];
    let x = x0;
    for (const a of atoms) {
      xs.push(x);
      x += a.w;
    }
    const end = (j: number) => xs[j - 1] + atoms[j - 1].w;
    const back: Item[] = [];
    const front: Item[] = [];
    const marks: Item[] = [];

    segments(atoms, (a) => a.run.code && !a.img, (i, j) => {
      const s = atoms[i].size;
      back.push({ k: 'rect', x: xs[i] - 1.5, y: base - s * 0.86, w: end(j) - xs[i] + 3, h: s * 1.16, fill: this.t.inlineCodeBg, r: 2 });
    });
    segments(atoms, (a) => a.run.href, (i, j, href) => {
      const top = Math.min(...atoms.slice(i, j).map((a) => base - (a.h ?? a.size * 0.9)));
      marks.push({ k: 'link', x: xs[i], y: top, w: end(j) - xs[i], h: Math.min(lineH, base + 3 - top), href });
    });
    segments(atoms, (a) => (a.run.href || a.run.u) && !a.img, (i, j) => {
      const s = atoms[i].size;
      front.push({ k: 'line', x1: xs[i], y1: base + s * 0.13, x2: end(j), y2: base + s * 0.13, lw: Math.max(0.5, s * 0.055), color: atoms[i].color });
    });
    segments(atoms, (a) => a.run.s && !a.img, (i, j) => {
      const s = atoms[i].size;
      front.push({ k: 'line', x1: xs[i], y1: base - s * 0.28, x2: end(j), y2: base - s * 0.28, lw: Math.max(0.5, s * 0.06), color: atoms[i].color });
    });

    const texts: Item[] = [];
    atoms.forEach((a, i) => {
      if (a.img) {
        texts.push({ k: 'img', x: xs[i], y: base - a.h!, w: a.w, h: a.h!, src: a.img });
        return;
      }
      if (!a.text) return;
      const prev = texts.at(-1);
      if (prev?.k === 'text' && prev.font === a.font && prev.size === a.size && prev.color === a.color && !!prev.skew === a.skew && Math.abs(prev.x + prev.w - xs[i]) < EPS) {
        prev.text += a.text;
        prev.w += a.w;
      } else {
        texts.push({ k: 'text', x: xs[i], y: base, w: a.w, text: a.text, font: a.font, size: a.size, color: a.color, skew: a.skew || undefined });
      }
    });
    return [...back, ...texts, ...front, ...marks];
  }

  private code(text: string, x: number, w: number, mb: number) {
    const t = this.t;
    const style: TextStyle = { family: 'mono', size: t.size * t.codeScale, lead: 1.45, color: t.codeFg };
    const pad = 8;
    const padX = 10;
    const inner = w - 2 * padX;
    const run: Run = { text };
    const lines: Line[] = [];
    for (const raw of text.replace(/\t/g, '    ').split('\n')) {
      // whitespace is kept as typed, and long lines wrap between any two characters
      const atoms = splitByFont(raw).map((part, k): Atom => {
        const ansi = isWinAnsi(part);
        const font = ansi ? fontKey('mono') : notoKey();
        return { text: part, font, skew: false, size: style.size, w: this.m(part, font) * style.size, color: style.color, run, join: k > 0 };
      });
      const width = sum(atoms);
      if (width <= inner + EPS) lines.push({ atoms, w: width });
      else for (const p of splitWord(atoms, inner, this.m)) lines.push({ atoms: p, w: sum(p) });
    }
    this.open({ x, w, padTop: pad, padBottom: pad, fill: t.codeBg, stroke: t.codeBorder ?? undefined, r: 4 });
    const n = lines.length;
    lines.forEach((line, k) => this.emit({ ...this.lineBox(line, x + padX, inner, style), keep: n > 1 && (k === 0 || k === n - 2) }));
    this.close();
    this.space(mb);
  }

  private list(ordered: boolean, start: number, items: ListItem[], x: number, w: number, ctx: Ctx, gap: number) {
    const t = this.t;
    const size = t.size;
    const font = fontKey(t.body, false, ctx.i);
    const labels = items.map((_, k) => `${start + k}.`);
    // reduce, not Math.max(...spread): a list can have more items than a call can take arguments
    const labelW = ordered ? labels.reduce((mx, s) => Math.max(mx, this.m(s, font) * size), 0) : 0;
    const indent = Math.max(size * 1.7, labelW + size * 0.7);
    const outer = ctx.depth === 0;
    items.forEach((item, k) => {
      if (k) this.space(size * 0.25);
      const first = this.boxes.length;
      this.blocks(item.blocks, x + indent, w - indent, { ...ctx, depth: ctx.depth + 1 });
      if (this.boxes.length === first) this.emit({ h: size * t.lead, base: size * t.lead * 0.5 + size * 0.3, items: [] });
      const box = this.boxes[first];
      const base = box.base ?? size;
      const right = x + indent - size * 0.45;
      const marker: Item[] = [];
      if (item.task) {
        const s = size * 0.78;
        const bx = right - s;
        const by = base - size * 0.74;
        if (item.task === 'done') {
          marker.push({ k: 'rect', x: bx, y: by, w: s, h: s, fill: t.accent, r: 1.5 });
          const pts = [
            [0.22, 0.52],
            [0.42, 0.72],
            [0.78, 0.3],
          ].map(([px, py]) => [bx + px * s, by + py * s]);
          for (let p = 0; p < 2; p++) marker.push({ k: 'line', x1: pts[p][0], y1: pts[p][1], x2: pts[p + 1][0], y2: pts[p + 1][1], lw: 1.2, color: '#ffffff' });
        } else {
          marker.push({ k: 'rect', x: bx, y: by, w: s, h: s, stroke: t.muted, lw: 0.8, r: 1.5 });
        }
      } else if (ordered) {
        const tw = this.m(labels[k], font) * size;
        marker.push({ k: 'text', x: right - tw, y: base, w: tw, text: labels[k], font, size, color: ctx.color });
      } else {
        const d = size * 0.34;
        const cx = right - size * 0.3;
        const cy = base - size * 0.3;
        const kind = ctx.depth % 3;
        marker.push(
          kind === 1
            ? { k: 'rect', x: cx - d / 2, y: cy - d / 2, w: d, h: d, stroke: ctx.color, lw: 0.7, r: d / 2 }
            : { k: 'rect', x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: ctx.color, r: kind === 0 ? d / 2 : 0 },
        );
      }
      box.items = [...marker, ...box.items];
    });
    if (outer) this.space(gap);
  }

  private image(img: InlineImage, href: string | undefined, x: number, w: number, ctx: Ctx) {
    const info = this.images[img.src];
    if (!info) {
      const size = this.t.size * 0.9;
      const h = size * 3;
      const font = fontKey(this.t.body, false, true);
      const text = clip(img.alt ? `Image: ${img.alt}` : 'Image unavailable', w - 24, (s) => this.m(s, font) * size);
      const tw = this.m(text, isWinAnsi(text) ? font : notoKey()) * size;
      this.emit({
        h,
        items: [
          { k: 'rect', x, y: 0.5, w, h: h - 1, stroke: this.t.rule, lw: 0.8, r: 4 },
          { k: 'text', x: x + (w - tw) / 2, y: h / 2 + size * 0.3, w: tw, text, font: isWinAnsi(text) ? font : notoKey(), skew: !isWinAnsi(text) || undefined, size, color: ctx.color === this.t.text ? this.t.muted : ctx.color },
        ],
      });
      return;
    }
    const box = imageBox(img, info, w, this.maxImgH);
    const items: Item[] = [{ k: 'img', x, y: 0, w: box.w, h: box.h, src: img.src }];
    if (href) items.push({ k: 'link', x, y: 0, w: box.w, h: box.h, href });
    this.emit({ h: box.h, items });
  }

  private table(align: Align[], head: Run[][] | null, body: Run[][][], x: number, w: number, ctx: Ctx) {
    const t = this.t;
    const rows = head ? [head, ...body] : body;
    const cols = rows.reduce((mx, r) => Math.max(mx, r.length), 0);
    if (!cols) return;
    const size = t.size * 0.95;
    const padX = 6;
    const padY = 4;
    const style = (r: number): TextStyle => ({ family: t.body, size, lead: 1.35, color: ctx.color, i: ctx.i, b: !!head && r === 0 });
    const cells = rows.map((row, r) => Array.from({ length: cols }, (_, c) => this.atoms(row[c] ?? [], style(r), w)));

    // column widths: natural widths if they fit, else shrink toward the longest word, like browsers do
    const minW = Array<number>(cols).fill(size + 2 * padX);
    const maxW = [...minW];
    for (const row of cells) {
      row.forEach((atoms, c) => {
        minW[c] = Math.max(minW[c], longestWord(atoms) + 2 * padX);
        maxW[c] = Math.max(maxW[c], ...breakLines(atoms, Infinity, this.m).map((l) => l.w + 2 * padX));
      });
    }
    const sumMin = minW.reduce((a, b) => a + b, 0);
    const sumMax = maxW.reduce((a, b) => a + b, 0);
    const widths =
      sumMax <= w
        ? maxW
        : sumMin <= w
          ? minW.map((mn, c) => mn + ((w - sumMin) * (maxW[c] - mn)) / Math.max(EPS, sumMax - sumMin))
          : minW.map((mn) => (mn * w) / sumMin);
    const tableW = widths.reduce((a, b) => a + b, 0);
    const lefts = widths.map((_, c) => x + widths.slice(0, c).reduce((a, b) => a + b, 0));

    const container: Container = { x, w: tableW, padTop: 0, padBottom: 0 };
    this.open(container);
    cells.forEach((row, r) => {
      const isHead = !!head && r === 0;
      const st = style(r);
      const lh = size * st.lead;
      const laid = row.map((atoms, c) => breakLines(atoms, widths[c] - 2 * padX, this.m));
      const h = Math.max(...laid.map((ls) => ls.length)) * lh + 2 * padY;
      const items: Item[] = [];
      if (isHead && t.tableHeadBg !== '#ffffff') items.push({ k: 'rect', x, y: 0, w: tableW, h, fill: t.tableHeadBg });
      laid.forEach((lines, c) => {
        lines.forEach((line, k) => {
          const content = this.lineBox(line, lefts[c] + padX, widths[c] - 2 * padX, { ...st, align: align[c] });
          for (const it of content.items) items.push(shift(it, padY + k * lh));
        });
      });
      if (t.tableGrid) {
        lefts.forEach((lx, c) => items.push({ k: 'rect', x: lx, y: 0, w: widths[c], h, stroke: t.rule, lw: 0.6 }));
      } else {
        if (r === 0) items.push({ k: 'line', x1: x, y1: 0, x2: x + tableW, y2: 0, lw: 0.9, color: t.text });
        const lastRow = r === cells.length - 1;
        items.push({ k: 'line', x1: x, y1: h, x2: x + tableW, y2: h, lw: isHead || lastRow ? 0.9 : 0.4, color: isHead || lastRow ? t.text : t.rule });
      }
      this.emit({ h, items, base: padY + lh / 2 + size * 0.3, keep: isHead });
      if (isHead) container.header = this.boxes.at(-1);
    });
    this.close();
  }
}

function imageBox(img: InlineImage, info: ImageSize, maxW: number, maxH: number) {
  const ratio = info.h / Math.max(1, info.w);
  const w = (img.width ?? (img.height ? img.height / ratio : info.w)) * PX;
  const h = (img.height ?? (img.width ? img.width * ratio : info.h)) * PX;
  const s = Math.min(1, maxW / Math.max(1, w), maxH / Math.max(1, h));
  return { w: w * s, h: h * s };
}

/** Calls fn for each run of atoms sharing a truthy key, without spaces at either end */
function segments<T>(atoms: Atom[], key: (a: Atom) => T | undefined | false | '', fn: (i: number, j: number, k: T) => void) {
  let i = 0;
  while (i < atoms.length) {
    const k = key(atoms[i]);
    if (!k || atoms[i].space) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < atoms.length && key(atoms[j]) === k) j++;
    let e = j;
    while (e > i + 1 && atoms[e - 1].space) e--;
    fn(i, e, k);
    i = j;
  }
}

function shift(it: Item, dy: number): Item {
  return it.k === 'line' ? { ...it, y1: it.y1 + dy, y2: it.y2 + dy } : { ...it, y: it.y + dy };
}

/** Shortens text with an ellipsis to fit width */
function clip(text: string, width: number, measure: (s: string) => number) {
  if (measure(text) <= width) return text;
  const chars = [...text];
  while (chars.length > 1 && measure(chars.join('') + '…') > width) chars.pop();
  return chars.join('') + '…';
}

/* ---------------- pagination ---------------- */

/**
 * Places boxes on pages top to bottom. Gaps vanish at the top of a page, a box
 * marked keep moves to the next page with the one after it (when they'd fit
 * there), containers get their padding and background on every page they span,
 * and a table's header row is repeated on each new page.
 */
function paginate(boxes: Box[], containers: Container[], top: number, bottom: number): Item[][] {
  const pages: Item[][] = [];
  let decos: { order: number; item: Item }[] = [];
  let items: Item[] = [];
  let y = top;
  let open: number[] = [];
  let order = 0;
  const fragTop = new Map<number, { y: number; order: number }>();

  const closeTo = (keep: number) => {
    for (let k = open.length - 1; k >= keep; k--) {
      const id = open[k];
      const c = containers[id];
      y += c.padBottom;
      const f = fragTop.get(id)!;
      if (c.fill || c.stroke) decos.push({ order: f.order, item: { k: 'rect', x: c.x, y: f.y, w: c.w, h: y - f.y, fill: c.fill, stroke: c.stroke, lw: c.stroke ? 0.8 : undefined, r: c.r } });
    }
    open = open.slice(0, keep);
  };
  const finish = () => {
    closeTo(0);
    decos.sort((a, b) => a.order - b.order);
    pages.push([...decos.map((d) => d.item), ...items]);
    decos = [];
    items = [];
    y = top;
  };
  const put = (box: Box) => {
    for (const it of box.items) items.push(shift(it, y));
    y += box.h;
  };
  const prefix = (cs: number[]) => {
    let n = 0;
    while (n < open.length && n < cs.length && open[n] === cs[n]) n++;
    return n;
  };
  const opening = (box: Box, from: number) =>
    box.cs.slice(from).reduce((s, id) => {
      const c = containers[id];
      return s + c.padTop + (c.header && c.header !== box ? c.header.h : 0);
    }, 0);

  let placed = 0;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const need = (first: boolean) => {
      const common = first ? 0 : prefix(box.cs);
      let h = first ? 0 : open.slice(common).reduce((s, id) => s + containers[id].padBottom, 0) + box.gap;
      h += opening(box, common) + box.h + box.cs.reduce((s, id) => s + containers[id].padBottom, 0);
      if (box.keep) {
        let extra = 0;
        for (let j = i; boxes[j].keep && j + 1 < boxes.length; j++) extra += boxes[j + 1].gap + boxes[j + 1].h;
        if (h + extra <= bottom - top) h += extra;
      }
      return h;
    };
    if (placed && y + need(false) > bottom + EPS) {
      finish();
      placed = 0;
    }
    const common = prefix(box.cs);
    closeTo(common);
    if (placed) y += box.gap;
    for (const id of box.cs.slice(common)) {
      const c = containers[id];
      fragTop.set(id, { y, order: order++ });
      open.push(id);
      y += c.padTop;
      if (c.header && c.header !== box) put(c.header);
    }
    put(box);
    placed++;
  }
  finish();
  return pages;
}

/* ---------------- the whole document ---------------- */

export function layoutDocument(blocks: Block[], opts: PageOptions, measure: Measure, images: Record<string, ImageSize> = {}): Layout {
  const theme = THEMES[opts.theme];
  const [width, height] = PAGE_SIZES[opts.size];
  const margin = marginPt(opts.margin);
  const cache = new Map<string, number>();
  const m: Measure = (text, font) => {
    const key = `${font}\u0000${text}`;
    let w = cache.get(key);
    if (w === undefined) cache.set(key, (w = measure(text, font)));
    return w;
  };
  const flow = new Flow(theme, m, images, (height - 2 * margin) * 0.92);
  flow.blocks(blocks, margin, width - 2 * margin, { color: theme.text, i: false, depth: 0 });
  const pages = paginate(flow.boxes, flow.containers, margin, height - margin);

  if (opts.numbers !== 'off') {
    const size = Math.min(9, theme.size * 0.82);
    const font = fontKey(theme.body);
    pages.forEach((items, k) => {
      const text = pageLabel(opts.numbers, k + 1, pages.length);
      const w = m(text, font) * size;
      const x = opts.numbers === 'bottom' || opts.numbers === 'bottom-total' ? (width - w) / 2 : width - margin - w;
      const y = opts.numbers === 'top-right' ? margin / 2 + size * 0.3 : height - margin / 2 + size * 0.3;
      items.push({ k: 'text', x, y, w, text, font, size, color: theme.muted });
    });
  }
  return { width, height, pages: pages.map((items) => ({ items })) };
}

/*
 * Reads a PDF page for PDF to Word / Excel / PowerPoint with pdf.js: text items with their font,
 * weight, slant and color, where pictures are drawn, and link targets. Pictures themselves are cut
 * out of a rendering of the page (cropPictures), so masks, transparency and odd encodings come
 * out as they look. Scanned pages go through OCR instead (ocrPage).
 */
import type Tesseract from 'tesseract.js';
import { canvasToBlob, loadPdfjs, renderPage, type PdfDoc } from '@/engines/pdf';
import type { PageInput, Rect, StyledItem } from './model';

type Matrix = number[];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** the unit square under a matrix, as a page-space rect (y down) */
function unitRect(m: Matrix, dx: number, dy: number): Rect {
  const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4] - dx, m[1] * x + m[3] * y + m[5] - dy]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => -p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** Joins pictures that touch or overlap into one (tiled images, a picture with its frame) */
export function mergeRects(rects: Rect[], gap = 2): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (a.x0 - gap > b.x1 || b.x0 - gap > a.x1 || a.top - gap > b.bottom || b.top - gap > a.bottom) continue;
        out[i] = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
        out.splice(j, 1);
        changed = true;
        break;
      }
  }
  return out;
}

const STANDARD: Record<string, string> = { Helvetica: 'Arial', Times: 'Times New Roman', Courier: 'Courier New', TimesNewRoman: 'Times New Roman', CourierNew: 'Courier New', ArialNarrow: 'Arial Narrow' };

/** "ABCDEF+TimesNewRomanPS-BoldItalicMT" → "Times New Roman" */
export function fontFamily(postscript: string | undefined, generic = 'sans-serif'): string {
  let name = (postscript ?? '').replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0].replace(/(PSMT|PS|MT)$/, '');
  name = name.replace(/(Bold|Italic|Oblique|Regular|Semibold|Light|Medium|Black)+$/i, '');
  if (STANDARD[name]) return STANDARD[name];
  if (!name || /^(g_|Type3|F\d|T\d|TT\d)/i.test(name)) return generic === 'serif' ? 'Times New Roman' : generic === 'monospace' ? 'Courier New' : 'Calibri';
  // CamelCase to words: "SegoeUI" → "Segoe UI", "OpenSans" → "Open Sans"
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

/**
 * pdf.js doesn't say an embedded font's name, only whether it's serif, sans or mono. The letter
 * width tells the common ones apart: Calibri sets about 0.43 em per letter, Arial 0.5; Times 0.42,
 * Cambria 0.47. `width` is the average advance per letter in em.
 */
export function guessFamily(generic: string | undefined, width: number, bold: boolean): string {
  const w = bold ? width - 0.03 : width;
  if (generic === 'monospace') return 'Courier New';
  if (generic === 'serif') return w >= 0.455 ? 'Cambria' : 'Times New Roman';
  return w > 0 && w < 0.465 ? 'Calibri' : 'Arial';
}

const near = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) < 60 && ((n >> 8) & 255) < 60 && (n & 255) < 60;
};

/** one character drawn by the page, with the fill color at the time */
interface Drawn {
  ch: string;
  color: string;
}

/**
 * The fill color each letter of each text item was drawn in (spaces take the letter before).
 * pdf.js text items and the drawing operators come in the same order but not one to one (it
 * merges runs in one font), so the letters are matched up.
 */
export function charColors(items: { str: string }[], drawn: Drawn[]): (string | undefined)[][] {
  let at = 0;
  return items.map((item) => {
    let color: string | undefined;
    return [...item.str].map((ch) => {
      if (/\s/.test(ch)) return color;
      let k = at;
      while (k < drawn.length && k - at < 200 && drawn[k].ch !== ch) k++;
      if (k < drawn.length && drawn[k].ch === ch) {
        color = near(drawn[k].color) ? undefined : drawn[k].color;
        at = k + 1;
      }
      return color;
    });
  });
}

/**
 * Cuts an upright item where its color changes and at link edges, so a blue link inside a black
 * sentence becomes its own run. Positions inside the item are shared out by letter count.
 */
export function splitItem(item: StyledItem, colors: (string | undefined)[], edges: number[] = []): StyledItem[] {
  const chars = [...item.str];
  const upright = Math.abs(item.transform[1]) < 1e-3 && Math.abs(item.transform[2]) < 1e-3 && item.transform[0] > 0;
  const x = item.transform[4];
  const per = chars.length ? item.width / chars.length : 0;
  const cuts = new Set<number>();
  if (upright) {
    for (let k = 1; k < chars.length; k++) if (colors[k] !== colors[k - 1] && !/\s/.test(chars[k])) cuts.add(k);
    // letter widths aren't known, so a link edge snaps to a color change close by (links are usually blue)
    const colorCuts = [...cuts];
    for (const e of edges) {
      const guess = Math.round((e - x) / (per || 1));
      const k = colorCuts.find((c) => Math.abs(c - guess) <= 3) ?? guess;
      if (k > 0 && k < chars.length) cuts.add(k);
    }
  }
  if (!cuts.size) return [{ ...item, color: colors.find((c) => c) }];
  const bounds = [0, ...[...cuts].sort((a, b) => a - b), chars.length];
  return bounds.slice(1).map((end, k) => {
    const from = bounds[k];
    const t = [...item.transform];
    t[4] = x + from * per;
    return { ...item, str: chars.slice(from, end).join(''), transform: t, width: (end - from) * per, color: colors[from] ?? colors.slice(from, end).find((c) => c) };
  });
}

export interface ReadPage {
  input: PageInput;
  /** no text but a picture: a scan, for OCR */
  scanned: boolean;
  /** page-space offset of the visible area, for rendering crops */
  view: number[];
}

/** Reads one page's text, styles, pictures and links */
export async function readPageInput(doc: PdfDoc, pageIndex: number): Promise<ReadPage> {
  const [page, lib] = await Promise.all([doc.getPage(pageIndex), loadPdfjs()]);
  try {
    const { OPS } = lib;
    const view = page.view;
    const [dx, dy] = view;
    const width = view[2] - view[0];
    const height = view[3] - view[1];
    // the operator list also loads the fonts, so their names and weights can be read below
    const ops = await page.getOperatorList();
    const content = await page.getTextContent();

    const pictures: Rect[] = [];
    const drawn: Drawn[] = [];
    let ctm = IDENTITY;
    let fill = '#000000';
    const stack: { ctm: Matrix; fill: string }[] = [];
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k];
      const args = ops.argsArray[k] as unknown[];
      if (fn === OPS.save) stack.push({ ctm, fill });
      else if (fn === OPS.restore) ({ ctm, fill } = stack.pop() ?? { ctm, fill });
      else if (fn === OPS.transform) ctm = multiply(ctm, args as number[]);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push({ ctm, fill });
        if (Array.isArray(args[0]) || ArrayBuffer.isView(args[0])) ctm = multiply(ctm, Array.from(args[0] as number[]));
      } else if (fn === OPS.paintFormXObjectEnd) ({ ctm, fill } = stack.pop() ?? { ctm, fill });
      else if (fn === OPS.setFillRGBColor && typeof args[0] === 'string') fill = args[0];
      else if (fn === OPS.showText || fn === OPS.showSpacedText) {
        for (const g of (args[0] as unknown[]) ?? []) {
          const unicode = typeof g === 'object' && g && 'unicode' in g ? String(g.unicode ?? '') : '';
          for (const ch of unicode) if (!/\s/.test(ch)) drawn.push({ ch, color: fill });
        }
      } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
        const r = unitRect(ctm, dx, dy);
        // skip specks and hairlines
        if (r.x1 - r.x0 >= 8 && r.bottom - r.top >= 8) pictures.push(r);
      }
    }

    const links: NonNullable<PageInput['links']> = [];
    for (const a of await page.getAnnotations({ intent: 'display' }).catch(() => [])) {
      const url = (a as { url?: string }).url;
      const rect = (a as { rect?: number[] }).rect;
      if (a.subtype === 'Link' && url && /^(https?:|mailto:)/i.test(url) && rect) links.push({ url, x0: rect[0] - dx, x1: rect[2] - dx, top: -(rect[3] - dy), bottom: -(rect[1] - dy) });
    }

    const raw = content.items.filter((i) => 'str' in i);
    const colors = charColors(raw, drawn);
    type FontObj = { name?: string; fallbackName?: string; bold?: boolean; italic?: boolean; black?: boolean; systemFontInfo?: { baseFontName?: string } };
    const fontOf = (id: string) => (page.commonObjs.has(id) ? (page.commonObjs.get(id) as FontObj) : undefined);
    // average letter width per font, for guessFamily
    const widths = new Map<string, { w: number; n: number }>();
    for (const it of raw) {
      const letters = it.str.replace(/\s/g, '').length;
      const size = Math.hypot(it.transform[2], it.transform[3]) || 1;
      if (!letters || it.width <= 0) continue;
      const s = widths.get(it.fontName) ?? { w: 0, n: 0 };
      // the item's width includes its spaces, about a quarter em each
      widths.set(it.fontName, { w: s.w + it.width / size - (it.str.length - letters) * 0.25, n: s.n + letters });
    }
    const items: StyledItem[] = raw.flatMap((it, k) => {
      const font = fontOf(it.fontName);
      const name = font?.name ?? font?.systemFontInfo?.baseFontName ?? '';
      const generic = content.styles[it.fontName]?.fontFamily;
      const avg = widths.get(it.fontName);
      const bold0 = !!font?.bold || !!font?.black || /bold|black|heavy|semibold|demi/i.test(name);
      const t = it.transform as number[];
      const item: StyledItem = {
        str: it.str,
        transform: [t[0], t[1], t[2], t[3], t[4] - dx, t[5] - dy],
        width: it.width,
        dir: it.dir,
        font: name ? fontFamily(name, generic) : guessFamily(generic, avg ? avg.w / avg.n : 0, bold0),
        bold: bold0,
        italic: !!font?.italic || /italic|oblique/i.test(name),
      };
      const base = -item.transform[5];
      const edges = links.filter((l) => base > l.top && base - 2 < l.bottom).flatMap((l) => [l.x0, l.x1]);
      return splitItem(item, colors[k], edges);
    });

    const hasText = items.some((i) => i.str.trim());
    return { input: { width, height, items, pictures: mergeRects(pictures.map((r) => clip(r, width, height))).filter((r) => r.x1 - r.x0 >= 8 && r.bottom - r.top >= 8), links }, scanned: !hasText && pictures.length > 0, view };
  } finally {
    page.cleanup();
  }
}

/** keeps a rect on the page */
const clip = (r: Rect, width: number, height: number): Rect => ({ x0: Math.max(0, r.x0), x1: Math.min(width, r.x1), top: Math.max(-height, r.top), bottom: Math.min(0, r.bottom) });

export interface Crop {
  data: Uint8Array;
  type: 'png' | 'jpg';
  /** pixels */
  width: number;
  height: number;
}

/**
 * Cuts the page's pictures out of one rendering of it at `dpi`. Photos become JPEG, small or
 * flat graphics PNG.
 */
export async function cropPictures(doc: PdfDoc, pageIndex: number, input: PageInput, { dpi = 150, signal }: { dpi?: number; signal?: AbortSignal } = {}): Promise<(Crop | null)[]> {
  if (!input.pictures.length) return [];
  const canvas = await renderPage(doc, pageIndex, { dpi, annotations: false, signal });
  try {
    const scale = canvas.width / input.width;
    const out: (Crop | null)[] = [];
    for (const r of input.pictures) {
      const x = Math.max(0, Math.floor(r.x0 * scale));
      const y = Math.max(0, Math.floor((input.height + r.top) * scale));
      const w = Math.min(canvas.width - x, Math.ceil((r.x1 - r.x0) * scale));
      const h = Math.min(canvas.height - y, Math.ceil((r.bottom - r.top) * scale));
      if (w < 2 || h < 2) {
        out.push(null);
        continue;
      }
      const piece = Object.assign(document.createElement('canvas'), { width: w, height: h });
      piece.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      const photo = w * h > 90_000;
      const blob = await canvasToBlob(piece, photo ? 'image/jpeg' : 'image/png', photo ? 0.88 : undefined);
      piece.width = 0;
      out.push({ data: new Uint8Array(await blob.arrayBuffer()), type: photo ? 'jpg' : 'png', width: w, height: h });
    }
    return out;
  } finally {
    canvas.width = 0;
  }
}

/**
 * A scanned page as a PageInput: Tesseract's words become text items at their place and size,
 * so headings, paragraphs and tables are found the same way as on a text page.
 */
export function ocrInput(result: Pick<Tesseract.Page, 'blocks'>, dpi: number, width: number, height: number, font = 'Calibri'): PageInput {
  const k = 72 / dpi;
  const items: StyledItem[] = [];
  for (const b of result.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines) {
        const rowPx = (l as { rowAttributes?: { row_height?: number } }).rowAttributes?.row_height || l.bbox.y1 - l.bbox.y0;
        const size = Math.max(4, Math.round(((rowPx * k) / 1.15) * 2) / 2);
        const baseline = l.baseline && Number.isFinite(l.baseline.y0) ? (l.baseline.y0 + l.baseline.y1) / 2 : l.bbox.y1 - (l.bbox.y1 - l.bbox.y0) * 0.2;
        for (const w of l.words) {
          const str = w.text.trim();
          if (!str) continue;
          items.push({ str, transform: [size, 0, 0, size, w.bbox.x0 * k, height - baseline * k], width: (w.bbox.x1 - w.bbox.x0) * k, font, bold: false, italic: false });
        }
      }
  return { width, height, items, pictures: [] };
}

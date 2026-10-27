/*
 * Paints pages the browser has laid out (a Word document rendered by docx-preview, a sheet, a slide)
 * into a PDF with real, selectable text. Phase one walks the DOM into a display list: backgrounds,
 * borders, every word with the box the browser gave it, pictures and links. Phase two cuts it into
 * PDF pages (a section longer than its page is split between lines) and draws it with pdf-lib.
 * Text uses the same font files the page was laid out in (fonts.ts), stretched by a hair where needed
 * so each word fills exactly its box; characters those fonts lack (CJK, Arabic, emoji…) are drawn as
 * small pictures instead.
 */
import type { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import { loadPdfLibModule } from '@/engines/pdf';
import { cssFamily, faceFor, familyFor, PdfFonts, type Variant } from './fonts';

const PT = 0.75; // CSS px → PDF points

type Rgb = [number, number, number];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Op =
  | (Box & { kind: 'rect'; color: Rgb; alpha: number })
  | (Box & { kind: 'text'; text: string; variant: Variant; face: Awaited<ReturnType<typeof faceFor>>; size: number; color: Rgb; alpha: number; ascent: number; font: string; deco: { under: boolean; strike: boolean } })
  | (Box & { kind: 'image'; source: CanvasImageSource | SVGSVGElement | string; key: string })
  | (Box & { kind: 'link'; url: string });

export interface PageSource {
  el: HTMLElement;
  /** the page height in CSS px when the element may run longer (a Word section): it's split into pages */
  pageHeight?: number;
  /** padding kept at the top and bottom of continuation pages, CSS px */
  margins?: { top: number; bottom: number };
  /** elements drawn on every page cut from this one (page headers and footers) */
  header?: HTMLElement | null;
  footer?: HTMLElement | null;
}

export interface PaintResult {
  bytes: Uint8Array;
  pages: number;
  /** words drawn as pictures because the fonts don't have their characters */
  pictured: number;
}

export function parseColor(css: string): { color: Rgb; alpha: number } | null {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\)/.exec(css);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return a <= 0.01 ? null : { color: [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255], alpha: Math.min(1, a) };
}

/**
 * Where to cut a tall page: as far down as `limit` without going through a line of text or a
 * picture, and not earlier than `min` (a block taller than a page is cut through).
 */
export function cutAt(boxes: { y: number; h: number }[], min: number, limit: number): number {
  const crosses = (c: number) => boxes.some((b) => b.y < c - 0.5 && b.y + b.h > c + 0.5);
  if (!crosses(limit)) return limit;
  const candidates = boxes.flatMap((b) => [b.y, b.y + b.h]).filter((c) => c > min && c < limit).sort((a, b) => b - a);
  return candidates.find((c) => !crosses(c)) ?? limit;
}

const ascents = new Map<string, number>();
/** the share of a text box above the baseline, for this font, measured the way the browser lays it out */
function ascentRatio(font: string): number {
  let r = ascents.get(font);
  if (r === undefined) {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = font;
    const m = ctx.measureText('Hg');
    r = m.fontBoundingBoxAscent && m.fontBoundingBoxDescent ? m.fontBoundingBoxAscent / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) : 0.8;
    ascents.set(font, r);
  }
  return r;
}

/** Points every element at the stand-in fonts so layout and PDF share metrics; waits for them to load */
export async function useStandInFonts(root: HTMLElement): Promise<void> {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    if (el instanceof SVGElement || el.closest('svg')) continue;
    const family = getComputedStyle(el).fontFamily;
    el.style.setProperty('font-family', cssFamily(familyFor(family)), 'important');
  }
  // pdf-lib draws glyph by glyph: no ligatures or kerning, so the browser must not use them either
  root.style.setProperty('font-variant-ligatures', 'none');
  root.style.setProperty('font-kerning', 'none');
  void root.offsetHeight;
  await document.fonts.ready;
}

const WORD = /\S+/g;

/** bullets from symbol fonts (Word's Symbol and Wingdings ones, ●, ■, ➢…) that the stand-in fonts lack */
const BULLET_LIKE = /[●○■□▪▫◆◇❖➢➔✓✔►▸]/;

/** Collects the display list of one page element; coordinates are CSS px from its top-left */
async function collect(el: HTMLElement, origin: DOMRect, skip: (Element | null | undefined)[] = []): Promise<Op[]> {
  const ops: Op[] = [];
  const rel = (r: DOMRect | DOMRectReadOnly): Box => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
  const range = document.createRange();

  const text = async (node: Text) => {
    const parent = node.parentElement!;
    const cs = getComputedStyle(parent);
    const fill = parseColor(cs.color);
    if (!fill || cs.visibility !== 'visible') return;
    const variant: Variant = { family: familyFor(cs.fontFamily), bold: parseInt(cs.fontWeight) >= 600, italic: cs.fontStyle !== 'normal' };
    const size = parseFloat(cs.fontSize);
    const font = `${variant.italic ? 'italic ' : ''}${variant.bold ? 700 : 400} 100px ${cssFamily(variant.family)}`;
    const ascent = ascentRatio(font);
    const deco = { under: cs.textDecorationLine.includes('underline'), strike: cs.textDecorationLine.includes('line-through') };
    for (const m of node.data.matchAll(WORD)) {
      // split the word into runs of characters one face covers (or none: those become a picture)
      const chars = [...m[0]];
      const runs: { from: number; to: number; face: Awaited<ReturnType<typeof faceFor>>; text: string }[] = [];
      let at = m.index;
      for (const raw of chars) {
        let ch = raw;
        let face = await faceFor(variant, ch.codePointAt(0)!);
        // a symbol-font bullet becomes a real • rather than a picture
        if (!face && BULLET_LIKE.test(ch)) face = await faceFor(variant, (ch = '•').codePointAt(0)!);
        const last = runs.at(-1);
        if (last && last.face === face) [last.to, last.text] = [at + raw.length, last.text + ch];
        else runs.push({ from: at, to: at + raw.length, face, text: ch });
        at += raw.length;
      }
      for (const run of runs) {
        range.setStart(node, run.from);
        range.setEnd(node, run.to);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) continue;
        // a word broken over two lines (hyphenation) is drawn piece by piece
        const pieces = rects.length === 1 ? [{ text: run.text, rect: rects[0] }] : perChar(node, run.from, run.to, range);
        for (const p of pieces) ops.push({ kind: 'text', ...rel(p.rect), text: p.text, variant, face: run.face, size, color: fill.color, alpha: fill.alpha, ascent, font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, deco });
      }
    }
  };

  const walk = async (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return text(node as Text);
    if (!(node instanceof Element) || skip.includes(node)) return;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    const r = node.getBoundingClientRect();
    if (node instanceof HTMLElement || node instanceof SVGSVGElement) {
      const bg = parseColor(cs.backgroundColor);
      if (bg && r.width && r.height) ops.push({ kind: 'rect', ...rel(r), ...bg });
      const img = /url\(["']?(data:image\/[^"')]+)["']?\)/.exec(cs.backgroundImage);
      if (img && r.width && r.height) ops.push({ kind: 'image', ...rel(r), source: img[1], key: img[1].slice(0, 200) });
      for (const [side, horizontal] of [['Top', true], ['Bottom', true], ['Left', false], ['Right', false]] as const) {
        const width = parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`));
        const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
        const color = parseColor(cs.getPropertyValue(`border-${side.toLowerCase()}-color`));
        if (!width || !color || style === 'none' || style === 'hidden') continue;
        const box = rel(r);
        // collapsed table borders are shared: the cell's box edge runs down the middle of them
        const shared = cs.borderCollapse === 'collapse' && (cs.display === 'table-cell' || cs.display === 'table');
        const inset = shared ? width / 2 : 0;
        const line: Box = horizontal
          ? { x: box.x - (shared ? inset : 0), y: side === 'Top' ? box.y - inset : box.y + box.h - width + inset, w: box.w + (shared ? width : 0), h: width }
          : { x: side === 'Left' ? box.x - inset : box.x + box.w - width + inset, y: box.y - (shared ? inset : 0), w: width, h: box.h + (shared ? width : 0) };
        ops.push({ kind: 'rect', ...line, ...color });
      }
    }
    if (node instanceof HTMLImageElement) {
      if (node.complete && node.naturalWidth && r.width && r.height) ops.push({ kind: 'image', ...rel(r), source: node, key: node.currentSrc || node.src });
      return;
    }
    if (node instanceof HTMLCanvasElement || node instanceof SVGSVGElement) {
      if (r.width && r.height) ops.push({ kind: 'image', ...rel(r), source: node, key: '' });
      return;
    }
    if (node instanceof HTMLAnchorElement && /^(https?:|mailto:)/i.test(node.href)) for (const lr of node.getClientRects()) ops.push({ kind: 'link', ...rel(lr), url: node.href });
    for (const child of node.childNodes) await walk(child);
  };

  await walk(el);
  return ops;
}

function perChar(node: Text, from: number, to: number, range: Range) {
  const out: { text: string; rect: DOMRect }[] = [];
  for (let i = from; i < to; ) {
    const len = node.data.codePointAt(i)! > 0xffff ? 2 : 1;
    range.setStart(node, i);
    range.setEnd(node, i + len);
    const rect = range.getBoundingClientRect();
    const last = out.at(-1);
    // characters on the same line join up again
    if (last && Math.abs(last.rect.top - rect.top) < 1) {
      last.text += node.data.slice(i, i + len);
      last.rect = new DOMRect(last.rect.left, last.rect.top, rect.right - last.rect.left, last.rect.height);
    } else if (rect.width) out.push({ text: node.data.slice(i, i + len), rect });
    i += len;
  }
  return out;
}

/** a word the fonts can't draw, as a PNG at 3× */
async function rasterText(op: Extract<Op, { kind: 'text' }>): Promise<Uint8Array | null> {
  const k = 3;
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(op.w * k), height: Math.ceil(op.h * k) });
  const ctx = canvas.getContext('2d')!;
  ctx.scale(k, k);
  ctx.font = op.font;
  ctx.fillStyle = `rgb(${op.color.map((c) => Math.round(c * 255)).join(',')})`;
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = op.alpha;
  const rtl = /[֐-ࣿ]/.test(op.text);
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.fillText(op.text, rtl ? op.w : 0, op.h * op.ascent);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** an image source (img, canvas, svg, data URL) as PNG or JPEG bytes for pdf-lib */
async function imageBytes(source: CanvasImageSource | SVGSVGElement | string, w: number, h: number): Promise<{ bytes: Uint8Array; png: boolean } | null> {
  if (typeof source === 'string' || (source instanceof HTMLImageElement && source.src.startsWith('data:image/'))) {
    const url = typeof source === 'string' ? source : source.src;
    const m = /^data:image\/(jpeg|jpg|png);base64,(.*)$/s.exec(url);
    if (m) return { bytes: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)), png: m[1] === 'png' };
    if (typeof source === 'string') {
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      if (!img.naturalWidth) return null;
      source = img;
    }
  }
  let drawable = source as CanvasImageSource;
  // SVG: drawn through an <img> of its markup
  if (source instanceof SVGSVGElement) {
    const markup = new XMLSerializer().serializeToString(source);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup.includes('xmlns=') ? markup : markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'))}`;
    await img.decode().catch(() => {});
    if (!img.naturalWidth && !img.width) return null;
    drawable = img;
  }
  // 2× the displayed size (at least the image's own pixels for photos, up to 3000 px)
  const natural = drawable instanceof HTMLImageElement ? Math.max(drawable.naturalWidth, 1) : 0;
  const scale = Math.min(3000 / Math.max(w, h), Math.max(2, natural ? natural / w : 2));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) });
  const ctx = canvas.getContext('2d')!;
  try {
    ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
  } catch {
    // a tainted or broken image: leave it out rather than fail the document
    return null;
  }
  const photo = drawable instanceof HTMLImageElement && /jpe?g/i.test(drawable.src.slice(0, 30));
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, photo ? 'image/jpeg' : 'image/png', 0.9));
  canvas.width = 0;
  return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), png: !photo } : null;
}

/**
 * Paints the pages into one PDF. `onPage(done, total)` reports progress; pages are cut where a
 * source is longer than its pageHeight.
 */
export async function paintPdf(sources: PageSource[], { onPage, signal, title }: { onPage?: (done: number, total: number) => void; signal?: AbortSignal; title?: string } = {}): Promise<PaintResult> {
  const { PDFDocument: Doc, rgb, PDFName, PDFString, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, setCharacterSqueeze } = await loadPdfLibModule();
  const doc: PDFDocument = await Doc.create();
  const { default: fontkit } = (await import('@pdf-lib/fontkit')) as unknown as { default: Parameters<PDFDocument['registerFontkit']>[0] };
  doc.registerFontkit(fontkit);
  if (title) doc.setTitle(title);
  doc.setCreator('Rounder Tools (roundertools.com)');
  const fonts = new PdfFonts(doc);
  const images = new Map<string, Promise<PDFImage | null>>();
  let pictured = 0;

  const embedImage = (op: Extract<Op, { kind: 'image' }>) => {
    const key = op.key || `${Math.random()}`;
    let p = images.get(key);
    if (!p) {
      p = imageBytes(op.source, op.w, op.h).then((b) => (b ? (b.png ? doc.embedPng(b.bytes) : doc.embedJpg(b.bytes)) : null)).catch(() => null);
      images.set(key, p);
    }
    return p;
  };

  for (const [n, src] of sources.entries()) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const origin = src.el.getBoundingClientRect();
    const width = origin.width;
    const total = src.el.scrollHeight > origin.height ? src.el.scrollHeight : origin.height;
    const pageH = src.pageHeight ?? total;
    // headers and footers are drawn on every page cut from this one, so they stay out of the flow
    const flow = await collect(src.el, origin, [src.header, src.footer]);
    const header = src.header ? await collect(src.header, origin) : [];
    const footer = src.footer ? await collect(src.footer, origin) : [];
    // the footer keeps its distance from the bottom edge
    const footerShift = total - pageH;

    // where each PDF page's slice of the source starts and ends
    const solid = flow.filter((op) => op.kind === 'text' || op.kind === 'image');
    const { top = 0, bottom = 0 } = src.margins ?? {};
    // a loop, not Math.max(...): a long sheet has more boxes than a call can take arguments
    let contentEnd = 0;
    for (const op of flow) if (op.kind !== 'rect') contentEnd = Math.max(contentEnd, op.y + op.h);
    const slices: { from: number; to: number; shift: number }[] = [];
    if (total <= pageH + 2 || contentEnd <= pageH - bottom + 1) slices.push({ from: -Infinity, to: Infinity, shift: 0 });
    else {
      let from = 0;
      let first = true;
      while (from < contentEnd - 1 && slices.length < 2000) {
        const room = first ? pageH - bottom : from + (pageH - top - bottom);
        const to = cutAt(solid, from + (pageH - top - bottom) / 3, room);
        slices.push({ from: first ? -Infinity : from, to, shift: first ? 0 : from - top });
        from = to;
        first = false;
      }
      slices[slices.length - 1].to = Infinity;
    }

    for (const slice of slices) {
      const page: PDFPage = doc.addPage([width * PT, pageH * PT]);
      const H = pageH * PT;
      const X = (x: number) => x * PT;
      const Y = (y: number, h: number, shift: number) => H - (y - shift + h) * PT;
      page.pushOperators(pushGraphicsState(), rectangle(0, 0, width * PT, H), clip(), endPath());
      const layers: [Op[], number, boolean][] = [
        [flow, slice.shift, true],
        [header, 0, false],
        [footer, footerShift, false],
      ];
      const annots: unknown[] = [];
      for (const [ops, shift, clipped] of layers) {
        for (const op of ops) {
          // what belongs to this slice: things that start inside it (backgrounds and borders may straddle)
          if (clipped && op.kind !== 'rect' && (op.y + op.h / 2 < slice.from || op.y + op.h / 2 >= slice.to)) continue;
          if (clipped && op.kind === 'rect' && (op.y + op.h <= slice.from || op.y >= slice.to)) continue;
          const y = Y(op.y, op.h, shift);
          if (op.kind === 'rect') {
            const from = clipped && Number.isFinite(slice.from) ? Math.max(op.y, slice.from) : op.y;
            const to = clipped && Number.isFinite(slice.to) ? Math.min(op.y + op.h, slice.to) : op.y + op.h;
            page.drawRectangle({ x: X(op.x), y: Y(from, to - from, shift), width: op.w * PT, height: (to - from) * PT, color: rgb(...op.color), opacity: op.alpha });
          } else if (op.kind === 'image') {
            const img = await embedImage(op);
            if (img) page.drawImage(img, { x: X(op.x), y, width: op.w * PT, height: op.h * PT });
          } else if (op.kind === 'link') {
            const rect = [X(op.x), y, X(op.x + op.w), y + op.h * PT];
            annots.push(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(op.url) } })));
          } else {
            const size = op.size * PT;
            const baseline = H - (op.y - shift + op.h * op.ascent) * PT;
            const color = rgb(...op.color);
            if (op.face) {
              const font = await fonts.get(op.face);
              const natural = font.widthOfTextAtSize(op.text, size);
              const squeeze = natural > 0 ? (op.w * PT * 100) / natural : 100;
              const fix = Math.abs(squeeze - 100) > 0.5 && squeeze > 50 && squeeze < 200;
              if (fix) page.pushOperators(setCharacterSqueeze(squeeze));
              page.drawText(op.text, { x: X(op.x), y: baseline, size, font, color, opacity: op.alpha });
              if (fix) page.pushOperators(setCharacterSqueeze(100));
            } else {
              const png = await rasterText(op);
              if (png) {
                page.drawImage(await doc.embedPng(png), { x: X(op.x), y, width: op.w * PT, height: op.h * PT });
                pictured++;
              }
            }
            const thick = Math.max(0.4, size / 16);
            if (op.deco.under) page.drawRectangle({ x: X(op.x), y: baseline - size * 0.12 - thick, width: op.w * PT, height: thick, color, opacity: op.alpha });
            if (op.deco.strike) page.drawRectangle({ x: X(op.x), y: baseline + size * 0.28, width: op.w * PT, height: thick, color, opacity: op.alpha });
          }
        }
      }
      page.pushOperators(popGraphicsState());
      if (annots.length) page.node.set(PDFName.of('Annots'), doc.context.obj(annots as never));
    }
    onPage?.(n + 1, sources.length);
  }
  const bytes = await doc.save();
  return { bytes, pages: doc.getPageCount(), pictured };
}

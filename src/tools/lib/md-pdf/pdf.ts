/** Fonts for measuring, and drawing a layout into a real PDF with pdf-lib (runs in the worker) */
import type { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import { PdfError } from '@/engines/pdf/errors';
import { loadPdfLibModule, savePdf } from '@/engines/pdf/lib';
import type { ImageSize, Layout, Measure } from './layout';
import type { FontKey } from './themes';

export interface PdfImage extends ImageSize {
  bytes: Uint8Array;
  kind: 'png' | 'jpg';
}

/** pdf-lib's names for the standard 14 fonts, which need no embedding */
const STANDARD: Record<Exclude<FontKey, 'noto-r' | 'noto-b'>, string> = {
  'sans-r': 'Helvetica',
  'sans-b': 'Helvetica-Bold',
  'sans-i': 'Helvetica-Oblique',
  'sans-bi': 'Helvetica-BoldOblique',
  'serif-r': 'Times-Roman',
  'serif-b': 'Times-Bold',
  'serif-i': 'Times-Italic',
  'serif-bi': 'Times-BoldItalic',
  'mono-r': 'Courier',
  'mono-b': 'Courier-Bold',
  'mono-i': 'Courier-Oblique',
  'mono-bi': 'Courier-BoldOblique',
};

/** the PDF engine's bundled Noto Sans (Latin, Greek, Cyrillic) */
const NOTO = { 'noto-r': 'NotoSans-Regular.ttf', 'noto-b': 'NotoSans-Bold.ttf' } as const;
const notoBytes = new Map<string, Promise<Uint8Array>>();

function notoFont(key: keyof typeof NOTO): Promise<Uint8Array> {
  let p = notoBytes.get(key);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}fonts/pdf/${NOTO[key]}`).then(async (r) => {
      if (!r.ok) throw new PdfError("The font for non-Latin text couldn't be loaded. Check your connection and try again.");
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => notoBytes.delete(key));
    notoBytes.set(key, p);
  }
  return p;
}

async function loadFontkit() {
  const m = await import('@pdf-lib/fontkit');
  // its types declare named exports, its ES build has only a default export
  return (m as unknown as { default?: typeof m }).default ?? m;
}

async function embedFonts(doc: PDFDocument, keys: Iterable<FontKey>) {
  const fonts = new Map<FontKey, PDFFont>();
  for (const key of keys) {
    if (key === 'noto-r' || key === 'noto-b') {
      doc.registerFontkit(await loadFontkit());
      // embedded whole: pdf-lib's subsetting loses glyphs from this font (е, т, м… go blank)
      fonts.set(key, await doc.embedFont(await notoFont(key)));
    } else fonts.set(key, await doc.embedFont(STANDARD[key]));
  }
  return fonts;
}

let scratch: Promise<PDFDocument> | undefined;
const measuring = new Map<FontKey, PDFFont>();

/** Widths from the same fonts the PDF will use; Noto Sans is only fetched when the text needs it */
export async function measurer(noto: boolean): Promise<Measure> {
  scratch ??= loadPdfLibModule().then(({ PDFDocument }) => PDFDocument.create());
  const doc = await scratch;
  const keys = [...(Object.keys(STANDARD) as FontKey[]), ...(noto ? (['noto-r', 'noto-b'] as const) : [])];
  for (const [key, font] of await embedFonts(doc, keys.filter((k) => !measuring.has(k)))) measuring.set(key, font);
  return (text, font) => measuring.get(font)!.widthOfTextAtSize(text, 1);
}

/**
 * A link target as a PDF literal string. pdf-lib writes PDFString values raw,
 * so an unbalanced "(" or a "\" would corrupt the file, and URIs must be 7-bit
 * ASCII: non-ASCII is percent-encoded (hosts become punycode) and \ ( ) escaped.
 */
export function pdfUri(href: string): string {
  let h = href;
  try {
    if (/^https?:/i.test(h)) h = new URL(h).href;
  } catch {
    // not a parseable URL: encode it as it is
  }
  const ascii = h.replace(/[^\x21-\x7e]/gu, (c) => {
    try {
      return encodeURIComponent(c);
    } catch {
      return ''; // a lone surrogate
    }
  });
  return ascii.replace(/[\\()]/g, '\\$&');
}

/** an SVG path for a rounded rectangle with its top-left corner at 0,0 */
function roundRect(w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  return `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

export async function paintPdf(layout: Layout, images: Record<string, PdfImage>, title: string): Promise<Blob> {
  const { PDFDocument, PDFString, rgb, degrees } = await loadPdfLibModule();
  const doc = await PDFDocument.create();
  if (title) doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setCreator('Rounder (roundertools.com)');

  const keys = new Set<FontKey>();
  const srcs = new Set<string>();
  for (const page of layout.pages) {
    for (const it of page.items) {
      if (it.k === 'text') keys.add(it.font);
      else if (it.k === 'img') srcs.add(it.src);
    }
  }
  const fonts = await embedFonts(doc, keys);
  const embedded = new Map<string, PDFImage>();
  for (const src of srcs) {
    const im = images[src];
    if (!im) continue;
    try {
      embedded.set(src, im.kind === 'png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes));
    } catch {
      // an image pdf-lib can't read is left out rather than failing the whole file
    }
  }

  const colors = new Map<string, ReturnType<typeof rgb>>();
  /** "#0969da" → pdf-lib color */
  const color = (hex: string) => {
    let c = colors.get(hex);
    if (!c) {
      const n = parseInt(hex.slice(1), 16);
      colors.set(hex, (c = rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)));
    }
    return c;
  };
  const link = (page: PDFPage, x1: number, y1: number, x2: number, y2: number, href: string) => {
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x1, y1, x2, y2],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(pdfUri(href)) },
    });
    page.node.addAnnot(doc.context.register(annot));
  };

  const H = layout.height;
  for (const { items } of layout.pages) {
    const page = doc.addPage([layout.width, H]);
    for (const it of items) {
      switch (it.k) {
        case 'text':
          page.drawText(it.text, { x: it.x, y: H - it.y, size: it.size, font: fonts.get(it.font), color: color(it.color), ySkew: it.skew ? degrees(12) : undefined });
          break;
        case 'rect': {
          const paint = {
            ...(it.fill ? { color: color(it.fill) } : {}),
            ...(it.stroke ? { borderColor: color(it.stroke), borderWidth: it.lw ?? 0.8 } : {}),
          };
          if (it.r) page.drawSvgPath(roundRect(it.w, it.h, it.r), { x: it.x, y: H - it.y, ...paint });
          else page.drawRectangle({ x: it.x, y: H - it.y - it.h, width: it.w, height: it.h, ...paint });
          break;
        }
        case 'line':
          page.drawLine({ start: { x: it.x1, y: H - it.y1 }, end: { x: it.x2, y: H - it.y2 }, thickness: it.lw, color: color(it.color) });
          break;
        case 'img': {
          const img = embedded.get(it.src);
          if (img) page.drawImage(img, { x: it.x, y: H - it.y - it.h, width: it.w, height: it.h });
          break;
        }
        case 'link':
          link(page, it.x, H - it.y - it.h, it.x + it.w, H - it.y, it.href);
          break;
      }
    }
  }
  return savePdf(doc);
}

import type { PDFDocument } from 'pdf-lib';
import { getPageSize, loadPdfLibModule, renderPage, type PdfDoc } from '@/engines/pdf';
import { toPgm } from './text';

/*
 * Scanned PDF → searchable PDF. Each page is rendered at ~300 dpi and read by Tesseract, which
 * also writes that page as a text-only PDF: invisible text (render mode 3) in its GlyphLessFont,
 * one run per word, sized and stretched to the word's box, for any script. We stamp that page
 * onto the ORIGINAL page as a Form XObject (the approach OCRmyPDF uses), so the scan stays
 * byte-for-byte as it was and the text becomes searchable and selectable.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** an embedded page's origin, its size before rotation, and the rotation */
export interface Placement extends Box {
  /** counter-clockwise degrees, as pdf-lib's drawPage takes them */
  rotate: number;
}

/**
 * Where to draw a text layer that was made from the page as displayed (its /Rotate applied) so
 * it lands on the page's unrotated content. `box` is the visible area (crop box) in user space.
 */
export function overlayPlacement(rotate: number, { x, y, width: w, height: h }: Box): Placement {
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      return { x: x + w, y, width: h, height: w, rotate: 90 };
    case 180:
      return { x: x + w, y: y + h, width: w, height: h, rotate: 180 };
    case 270:
      return { x, y: y + h, width: h, height: w, rotate: 270 };
    default:
      return { x, y, width: w, height: h, rotate: 0 };
  }
}

/** The part of the crop box inside the media box: what viewers (and pdf.js) show */
export function visibleBox(media: Box, crop: Box): Box {
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : media;
}

/** a page counts as already searchable from this many letters (stray page numbers don't) */
export const TEXT_THRESHOLD = 20;
export const hasRealText = (text: string) => text.replace(/\s/g, '').length >= TEXT_THRESHOLD;

/** Renders a page for Tesseract: grayscale PGM bytes and the dpi it was drawn at */
export async function renderForOcr(doc: PdfDoc, pageIndex: number, signal?: AbortSignal): Promise<{ image: Uint8Array<ArrayBuffer>; dpi: number }> {
  // annotations stay out: their text is already real text, and form fields would be read twice
  const [canvas, size] = await Promise.all([renderPage(doc, pageIndex, { dpi: 300, annotations: false, signal }), getPageSize(doc, pageIndex)]);
  try {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    return { image: toPgm(data, canvas.width, canvas.height), dpi: Math.round((canvas.width / size.width) * 72) };
  } finally {
    // lets the browser free ~35 MB before the next page
    canvas.width = 0;
  }
}

/**
 * Stamps Tesseract's text-only PDF pages onto the original pages (page index → PDF bytes).
 * The original content is wrapped in q…Q first so an unbalanced transform in it can't shift the layer.
 */
export async function addTextLayers(doc: PDFDocument, layers: ReadonlyMap<number, Uint8Array>): Promise<void> {
  const { degrees, popGraphicsState, pushGraphicsState } = await loadPdfLibModule();
  const pages = doc.getPages();
  for (const [index, bytes] of layers) {
    const page = pages[index];
    if (!page) continue;
    const [layer] = await doc.embedPdf(bytes, [0]);
    page.node.normalize();
    const ctx = doc.context;
    page.node.wrapContentStreams(ctx.register(ctx.contentStream([pushGraphicsState()])), ctx.register(ctx.contentStream([popGraphicsState()])));
    const at = overlayPlacement(page.getRotation().angle, visibleBox(page.getMediaBox(), page.getCropBox()));
    page.drawPage(layer, { x: at.x, y: at.y, width: at.width, height: at.height, rotate: degrees(at.rotate) });
  }
}

/** Plain text of the whole document, with a "Page N" line before each page */
export function documentText(pages: readonly (string | null | undefined)[]): string {
  return pages
    .map((text, i) => `── Page ${i + 1} ──\n\n${text?.trim() || '(no text found)'}`)
    .join('\n\n\n');
}

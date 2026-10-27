import type { PDFDocument, PDFFont, PDFName, PDFOperator, PDFPage, PDFRef } from 'pdf-lib';
import { embedFontWithFallback, isWinAnsi, loadPdfLibModule, missingGlyphs } from '@/engines/pdf';
import { hexToRgb, labelOrigin, markPlacements, numberingPlan, formatPageLabel, pageFrame, resolveAngle, visibleBox, type Anchor, type AngleMode, type Frame, type Placement } from './geometry';

export type FontFamily = 'sans' | 'serif' | 'mono';

const fontCache = new WeakMap<PDFDocument, Map<string, Promise<PDFFont>>>();

/**
 * Helvetica, Times or Courier when they can draw every character of `text`;
 * otherwise the engine's embedded Noto Sans (Latin, Greek, Cyrillic), subset.
 */
export function stampFont(doc: PDFDocument, family: FontFamily, bold: boolean, text: string): Promise<PDFFont> {
  if (family === 'sans' || !isWinAnsi(text)) return embedFontWithFallback(doc, text, { bold });
  let fonts = fontCache.get(doc);
  if (!fonts) fontCache.set(doc, (fonts = new Map()));
  const key = `${family}${bold ? '-bold' : ''}`;
  let font = fonts.get(key);
  if (!font) {
    font = loadPdfLibModule().then(({ StandardFonts: S }) =>
      doc.embedFont(family === 'serif' ? (bold ? S.TimesRomanBold : S.TimesRoman) : bold ? S.CourierBold : S.Courier),
    );
    fonts.set(key, font);
  }
  return font;
}

/** Width, full height (ascender to descender) and descent of one line, in points */
export function textBox(font: PDFFont, text: string, size: number) {
  const height = font.heightAtSize(size);
  return { width: font.widthOfTextAtSize(text, size), height, descent: height - font.heightAtSize(size, { descender: false }) };
}

let scratch: Promise<PDFDocument> | undefined;
/** The font the output will use, on a throwaway document, so the preview can measure with it */
export async function previewFont(family: FontFamily, bold: boolean, text: string): Promise<PDFFont> {
  scratch ??= loadPdfLibModule().then(({ PDFDocument }) => PDFDocument.create());
  return stampFont(await scratch, family, bold, text);
}

/* ---------------- low-level page plumbing ---------------- */

/** The page as seen: CropBox ∩ MediaBox with /Rotate */
export function frameOf(page: PDFPage): Frame {
  const m = page.getMediaBox();
  const c = page.getCropBox();
  const box = visibleBox([m.x, m.y, m.x + m.width, m.y + m.height], [c.x, c.y, c.x + c.width, c.y + c.height]);
  return pageFrame(box, page.getRotation().angle);
}

type ResourceKind = 'Font' | 'XObject' | 'ExtGState';

/** A resource name for `ref` on this page, reusing an existing entry (pages often share one inherited Resources dict) */
function resourceName(page: PDFPage, kind: ResourceKind, ref: PDFRef): PDFName {
  const dict = page.node.normalizedEntries()[kind];
  for (const [name, value] of dict.entries()) if (value === ref) return name;
  if (kind === 'Font') return page.node.newFontDictionary('RnF', ref);
  if (kind === 'XObject') return page.node.newXObject('RnX', ref);
  return page.node.newExtGState('RnG', ref);
}

/**
 * Adds a content stream to the page. pdf-lib wraps the existing content in
 * q/Q first, so ours starts from a clean graphics state. `under` puts it
 * before the page's own content, so text, images and fills draw on top of it.
 */
function addStream(doc: PDFDocument, page: PDFPage, ops: PDFOperator[], under = false) {
  const ref = doc.context.register(doc.context.contentStream(ops));
  page.node.addContentStream(ref);
  if (!under) return;
  const contents = page.node.Contents();
  if (contents && 'insert' in contents) {
    contents.remove(contents.size() - 1);
    contents.insert(0, ref);
  }
}

const opacityStates = new WeakMap<PDFDocument, Map<number, PDFRef>>();
function opacityState(doc: PDFDocument, opacity: number): PDFRef {
  let states = opacityStates.get(doc);
  if (!states) opacityStates.set(doc, (states = new Map()));
  let ref = states.get(opacity);
  if (!ref) {
    ref = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity }));
    states.set(opacity, ref);
  }
  return ref;
}

// big documents: let the page breathe between batches of pages
const tick = () => new Promise((r) => setTimeout(r));

export class StampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StampError';
  }
}

/** Characters even the fallback font lacks would print as empty boxes. The UI warns too, but its check can lag a quick click. */
async function assertDrawable(text: string, bold: boolean) {
  const missing = await missingGlyphs(text, { bold });
  if (missing.length) throw new StampError(`The PDF font can't draw ${missing.join(' ')}. Remove ${missing.length === 1 ? 'it' : 'them'} and try again.`);
}

/** pdf.js and pdf-lib can count pages differently on a repaired file */
const existing = (pages: number[], count: number) => pages.filter((i) => i >= 0 && i < count);

/* ---------------- page numbers ---------------- */

export interface PageNumberOptions {
  /** 0-based pages to number */
  pages: number[];
  skipFirst: boolean;
  start: number;
  template: string;
  anchor: Anchor;
  margin: number;
  family: FontFamily;
  bold: boolean;
  size: number;
  color: string;
}

export async function addPageNumbers(doc: PDFDocument, o: PageNumberOptions, onprogress?: (fraction: number) => void) {
  const ops = await loadPdfLibModule();
  const pages = doc.getPages();
  const plan = numberingPlan(existing(o.pages, pages.length), o);
  // the template decides whether a Unicode font is needed; digits never do
  const sample = formatPageLabel(o.template, 0, 0);
  await assertDrawable(sample, o.bold);
  const font = await stampFont(doc, o.family, o.bold, sample);
  const [r, g, b] = hexToRgb(o.color);
  for (const [k, { pageIndex, n }] of plan.pages.entries()) {
    const page = pages[pageIndex];
    const label = formatPageLabel(o.template, n, plan.total);
    if (!label.trim()) continue;
    const { width: W, height: H, matrix } = frameOf(page);
    const at = labelOrigin(W, H, textBox(font, label, o.size), o.anchor, o.margin);
    addStream(doc, page, [
      ops.pushGraphicsState(),
      ops.concatTransformationMatrix(...matrix),
      ops.beginText(),
      ops.setFontAndSize(resourceName(page, 'Font', font.ref), o.size),
      ops.setFillingRgbColor(r, g, b),
      ops.setTextMatrix(1, 0, 0, 1, at.x, at.y),
      ops.showText(font.encodeText(label)),
      ops.endText(),
      ops.popGraphicsState(),
    ]);
    if (k % 25 === 24) {
      onprogress?.(k / plan.pages.length);
      await tick();
    }
  }
  return plan.pages.length;
}

/* ---------------- watermark ---------------- */

export type WatermarkMark = { kind: 'text'; text: string; family: FontFamily; bold: boolean; size: number; color: string } | { kind: 'image'; bytes: Uint8Array; type: 'png' | 'jpg'; scale: number };

export interface WatermarkOptions {
  mark: WatermarkMark;
  /** 0-based pages to stamp */
  pages: number[];
  opacity: number;
  angleMode: AngleMode;
  angle: number;
  placement: Placement;
  /** margin from the edges, or the gap between tiles */
  margin: number;
  under: boolean;
}

export async function addWatermark(doc: PDFDocument, o: WatermarkOptions, onprogress?: (fraction: number) => void) {
  const ops = await loadPdfLibModule();
  const { mark } = o;
  // the mark is stored once as an XObject and placed on every page by reference
  let xobject: PDFRef;
  let size: (W: number) => { w: number; h: number };
  if (mark.kind === 'text') {
    await assertDrawable(mark.text, mark.bold);
    const font = await stampFont(doc, mark.family, mark.bold, mark.text);
    const box = textBox(font, mark.text, mark.size);
    const pad = mark.size; // room for accents and overhangs past the font's ascent
    const [r, g, b] = hexToRgb(mark.color);
    xobject = doc.context.register(
      doc.context.formXObject(
        [ops.beginText(), ops.setFontAndSize('F0', mark.size), ops.setFillingRgbColor(r, g, b), ops.setTextMatrix(1, 0, 0, 1, 0, box.descent), ops.showText(font.encodeText(mark.text)), ops.endText()],
        { BBox: [-pad, -pad, box.width + pad, box.height + pad], Resources: { Font: { F0: font.ref } } },
      ),
    );
    size = () => ({ w: box.width, h: box.height });
  } else {
    let image;
    try {
      image = mark.type === 'png' ? await doc.embedPng(mark.bytes) : await doc.embedJpg(mark.bytes);
    } catch {
      throw new StampError("The watermark image couldn't be read. Try another PNG or JPG.");
    }
    xobject = image.ref;
    const aspect = image.height / image.width;
    size = (W) => ({ w: (W * mark.scale) / 100, h: (W * mark.scale * aspect) / 100 });
  }
  const unit = mark.kind === 'image';
  const gs = o.opacity < 1 ? opacityState(doc, Math.round(o.opacity * 100) / 100) : undefined;
  const pages = doc.getPages();
  const wanted = existing([...new Set(o.pages)], pages.length);
  for (const [k, pageIndex] of wanted.entries()) {
    const page = pages[pageIndex];
    const { width: W, height: H, matrix } = frameOf(page);
    const { w, h } = size(W);
    const angle = resolveAngle(o.angleMode, o.angle, W, H);
    const name = resourceName(page, 'XObject', xobject);
    const body: PDFOperator[] = [ops.pushGraphicsState(), ops.concatTransformationMatrix(...matrix)];
    if (gs) body.push(ops.setGraphicsState(resourceName(page, 'ExtGState', gs)));
    for (const m of markPlacements(W, H, w, h, { angle, placement: o.placement, margin: o.margin, unit })) {
      body.push(ops.pushGraphicsState(), ops.concatTransformationMatrix(...m), ops.drawObject(name), ops.popGraphicsState());
    }
    body.push(ops.popGraphicsState());
    addStream(doc, page, body, o.under);
    if (k % 25 === 24) {
      onprogress?.(k / wanted.length);
      await tick();
    }
  }
  return wanted.length;
}

/** Sniffs PNG / JPEG from the first bytes; anything else is unsupported */
export function imageType(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}


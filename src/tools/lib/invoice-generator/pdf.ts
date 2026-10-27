import type { PDFDocument, PDFFont } from 'pdf-lib';
import { PdfError } from '@/engines/pdf/errors';
import { isWinAnsi, loadPdfLibModule, missingGlyphs, savePdf } from '@/engines/pdf/lib';
import type { Invoice } from './invoice';
import { layoutInvoice, type FontKey, type Formatters, type Layout } from './layout';
import type { Totals } from './money';

/** every string a layout draws */
const drawnText = (layout: Layout) => layout.pages.flatMap((ops) => ops.flatMap((op) => (op.t === 'text' ? [op.text] : []))).join('\n');

/**
 * Noto Sans (bundled with the PDF engine) for text Helvetica can't draw. Embedded
 * whole: pdf-lib's subsetting drops most of this font's glyphs, which would leave
 * gaps in the invoice, so a non-Latin invoice is bigger (roughly half a megabyte) but complete.
 */
async function embedNoto(doc: PDFDocument, bold: boolean) {
  const [fontkit, res] = await Promise.all([
    import('@pdf-lib/fontkit').then((m) => (m as unknown as { default?: typeof m }).default ?? m),
    fetch(`${import.meta.env.BASE_URL}fonts/pdf/NotoSans-${bold ? 'Bold' : 'Regular'}.ttf`),
  ]);
  if (!res.ok) throw new PdfError("The font for non-Latin text couldn't be loaded. Check your connection and try again.");
  doc.registerFontkit(fontkit);
  return doc.embedFont(new Uint8Array(await res.arrayBuffer()), { subset: false });
}

const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/**
 * Builds the invoice as a vector PDF. Text stays real, selectable text: Helvetica
 * (and Times for the Classic title) when it can draw everything, otherwise
 * embedded Noto Sans. `missing` lists characters no bundled font has.
 */
export async function invoicePdf(inv: Invoice, totals: Totals, f: Formatters, logoPng: Uint8Array | null) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLibModule();
  const doc = await PDFDocument.create();
  const image = logoPng ? await doc.embedPng(logoPng) : null;
  const logo = image && { width: image.width, height: image.height };
  // a rough first pass collects exactly what will be drawn (quantities and prices included) to pick fonts that cover it
  const texts = drawnText(layoutInvoice(inv, totals, f, (s, size) => s.length * size * 0.5, logo));
  const latin = isWinAnsi(texts);
  const [regular, bold] = latin
    ? await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)])
    : await Promise.all([embedNoto(doc, false), embedNoto(doc, true)]);
  const title = inv.title.trim() || 'Invoice';
  const fonts: Record<FontKey, PDFFont> = {
    regular,
    bold,
    serif: latin ? await doc.embedFont(StandardFonts.TimesRoman) : bold,
  };
  const measure = (s: string, size: number, font: FontKey) => fonts[font].widthOfTextAtSize(s, size);
  const layout: Layout = layoutInvoice(inv, totals, f, measure, logo);

  const H = layout.height;
  for (const ops of layout.pages) {
    const page = doc.addPage([layout.width, H]);
    for (const op of ops) {
      if (op.t === 'text') page.drawText(op.text, { x: op.x, y: H - op.y, size: op.size, font: fonts[op.font], color: rgb(...hexRgb(op.color)) });
      else if (op.t === 'rect') page.drawRectangle({ x: op.x, y: H - op.y - op.h, width: op.w, height: op.h, color: rgb(...hexRgb(op.color)) });
      else if (op.t === 'line') page.drawLine({ start: { x: op.x1, y: H - op.y1 }, end: { x: op.x2, y: H - op.y2 }, thickness: op.width, color: rgb(...hexRgb(op.color)) });
      else if (image) page.drawImage(image, { x: op.x, y: H - op.y - op.h, width: op.w, height: op.h });
    }
  }

  const ref = [title, inv.number.trim()].filter(Boolean).join(' ');
  doc.setTitle(inv.from.name.trim() ? `${ref} from ${inv.from.name.trim()}` : ref);
  if (inv.from.name.trim()) doc.setAuthor(inv.from.name.trim());
  doc.setCreator('Rounder invoice generator');
  doc.setProducer('Rounder (roundertools.com)');

  const [blob, missing] = await Promise.all([savePdf(doc), missingGlyphs(texts)]);
  return { blob, missing };
}

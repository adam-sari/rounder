import { loadPdfLibModule } from '@/engines/pdf/lib';

/** a one-page PDF with an empty page of this size, in points */
export async function blankPdf(width: number, height: number): Promise<Uint8Array> {
  const { PDFDocument } = await loadPdfLibModule();
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return doc.save();
}

/** the size a blank page needs to look like `size` once turned by `rotation` more degrees */
export function blankSize(size: { width: number; height: number }, rotation: number) {
  const r = Math.round(Math.max(1, size.width) * 100) / 100;
  const s = Math.round(Math.max(1, size.height) * 100) / 100;
  return rotation % 180 ? { width: s, height: r } : { width: r, height: s };
}

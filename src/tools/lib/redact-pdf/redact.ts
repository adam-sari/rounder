import { canvasToBlob, getText, loadEditablePdf, openPdf, PdfError, renderPage, savePdf, textToString, type PdfDoc } from '@/engines/pdf';
import { detachPages, dropUnreachable, replacePageWithImage, stripHidden, type StripOptions } from './clean';
import type { Box } from './geometry';
import type { Place } from './verify';

export interface RedactJob extends StripOptions {
  file: File;
  password?: string;
  /** the same file open in pdf.js, for rendering */
  view: PdfDoc;
  /** boxes per page index, in unrotated top-left points */
  boxes: Map<number, Box[]>;
  color: string;
  dpi: number;
  onprogress?: (step: string) => void;
}

/**
 * Builds the redacted PDF: each marked page is rendered to pixels, the boxes
 * are painted in, and the page is replaced by that image. Unmarked pages are
 * left as they are.
 */
export async function redactPdf(job: RedactJob): Promise<Blob> {
  const { view, boxes, onprogress } = job;
  onprogress?.('Preparing…');
  const { doc } = await loadEditablePdf(job.file, { password: job.password });
  if (doc.getPageCount() !== view.numPages) throw new PdfError("This PDF's pages couldn't be matched up for redaction. It may be damaged.");
  const pages = [...boxes.keys()].sort((a, b) => a - b);
  await detachPages(doc, pages);

  for (const [k, i] of pages.entries()) {
    onprogress?.(`Redacting page ${i + 1} (${k + 1} of ${pages.length})…`);
    const page = await view.getPage(i);
    const [x1, y1, x2, y2] = page.view;
    // drawn unrotated so the image and the boxes share the text's coordinates
    const canvas = await renderPage(view, i, { dpi: job.dpi, rotation: -page.rotate });
    const ctx = canvas.getContext('2d')!;
    const sx = canvas.width / (x2 - x1);
    const sy = canvas.height / (y2 - y1);
    ctx.fillStyle = job.color;
    for (const b of boxes.get(i)!) {
      // whole pixels, rounded outwards, so no half-covered edge is left
      const left = Math.floor(b.x * sx);
      const top = Math.floor(b.y * sy);
      ctx.fillRect(left, top, Math.ceil((b.x + b.width) * sx) - left, Math.ceil((b.y + b.height) * sy) - top);
    }
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    canvas.width = canvas.height = 0;
    const image = await doc.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
    await replacePageWithImage(doc, i, image.ref, [x1, y1, x2, y2]);
  }

  onprogress?.('Saving…');
  await stripHidden(doc, job);
  await dropUnreachable(doc);
  return savePdf(doc);
}

/** Everything readable in a saved PDF: page text plus metadata, bookmarks and comments */
export async function readBack(blob: Blob, onprogress?: (step: string) => void): Promise<{ pages: string[]; extras: Place[] }> {
  const doc = await openPdf(blob);
  try {
    const pages: string[] = [];
    const extras: Place[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      if (i % 10 === 0) onprogress?.(`Checking the saved file (page ${i + 1} of ${doc.numPages})…`);
      pages.push(textToString((await getText(doc, i)).items));
      const page = await doc.getPage(i);
      for (const a of await page.getAnnotations()) {
        const text = [a.contentsObj?.str, a.titleObj?.str, a.fieldValue, a.alternativeText].filter((s) => typeof s === 'string').join(' ');
        if (text.trim()) extras.push({ where: `comments or fields on page ${i + 1}`, text });
      }
    }
    const { info, metadata } = await doc.proxy.getMetadata();
    // pdf.js adds its own entries (PDFFormatVersion "1.7" and the like); only the file's own fields count
    const fields = info as Record<string, unknown> | undefined;
    const custom = fields?.Custom && typeof fields.Custom === 'object' ? Object.values(fields.Custom) : [];
    const infoText = [...['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'].map((k) => fields?.[k]), ...custom].filter((v) => typeof v === 'string').join(' ');
    if (infoText) extras.push({ where: 'the document properties', text: infoText });
    const xmp = metadata?.getRaw();
    if (typeof xmp === 'string') extras.push({ where: 'the XMP metadata', text: xmp });
    const titles: string[] = [];
    const walk = (items: { title: string; items: unknown[] }[] | null) => items?.forEach((o) => (titles.push(o.title), walk(o.items as typeof items)));
    walk(await doc.proxy.getOutline());
    if (titles.length) extras.push({ where: 'bookmarks', text: titles.join('\n') });
    return { pages, extras };
  } finally {
    void doc.destroy();
  }
}

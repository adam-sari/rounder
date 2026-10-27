import { abortError, loadPdfjs, type PdfDoc } from '@/engines/pdf';
import { layoutPage, type Paragraph } from './layout';

export interface PageResult {
  /** null when the page has no text at all */
  paragraphs: Paragraph[] | null;
  /** no text but it paints images: almost certainly a scan */
  scanned: boolean;
  /** pdf.js couldn't read this page */
  failed?: boolean;
}

/** True when the page draws an image (checked only for pages without text, as it decodes them) */
async function paintsImages(doc: PdfDoc, pageIndex: number): Promise<boolean> {
  const [page, { OPS }] = await Promise.all([doc.getPage(pageIndex), loadPdfjs()]);
  const ops = await page.getOperatorList();
  const image = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject]);
  return ops.fnArray.some((fn) => image.has(fn));
}

/** Reads one page's text with pdf.js and lays it out */
export async function readPage(doc: PdfDoc, pageIndex: number): Promise<PageResult> {
  const page = await doc.getPage(pageIndex);
  try {
    const content = await page.getTextContent();
    const items = content.items.filter((i) => 'str' in i);
    const paragraphs = layoutPage(items);
    if (paragraphs.length) return { paragraphs, scanned: false };
    return { paragraphs: null, scanned: await paintsImages(doc, pageIndex) };
  } finally {
    // drops parsed fonts and decoded images; matters across hundreds of pages
    page.cleanup();
  }
}

/** Reads every page in order, reporting each as it lands; pdf.js parses in its own worker */
export async function readAll(doc: PdfDoc, onPage: (index: number, result: PageResult) => void, signal: AbortSignal) {
  for (let i = 0; i < doc.numPages; i++) {
    if (signal.aborted) throw abortError();
    let result: PageResult;
    try {
      result = await readPage(doc, i);
    } catch (e) {
      if (signal.aborted) throw abortError();
      // one broken page shouldn't sink a 500-page document
      console.warn(`Page ${i + 1}:`, e);
      result = { paragraphs: null, scanned: false, failed: true };
    }
    onPage(i, result);
  }
}

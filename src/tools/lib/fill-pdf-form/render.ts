import { canvasToBlob, loadPdfjs, PdfError, type PdfDoc } from '@/engines/pdf';

/**
 * Draws a page without its form fields, which the tool overlays as live
 * inputs, and returns it as a JPEG object URL for the caller to revoke.
 */
export async function renderFormPage(doc: PdfDoc, pageIndex: number, width: number): Promise<string> {
  const [lib, page] = await Promise.all([loadPdfjs(), doc.getPage(pageIndex)]);
  const base = page.getViewport({ scale: 1 });
  // iOS Safari gives up on canvases past ~16.7M pixels
  const scale = Math.min(width / base.width, Math.sqrt(16e6 / (base.width * base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
  try {
    await page.render({
      canvas,
      viewport,
      // ENABLE_FORMS skips text and choice fields; checkboxes, radios and read-only
      // fields go to their own canvases in this map, which we simply drop
      annotationMode: lib.AnnotationMode.ENABLE_FORMS,
      annotationCanvasMap: new Map(),
      background: 'white',
    }).promise;
  } catch {
    throw new PdfError(`Page ${pageIndex + 1} couldn't be drawn. The file may be damaged.`, 'damaged');
  } finally {
    page.cleanup();
  }
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  canvas.width = 0; // frees its pixels now rather than at GC
  return URL.createObjectURL(blob);
}

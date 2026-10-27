import { canvasToBlob, renderPage, type PdfDoc } from '@/engines/pdf';
import { describeRestrictions } from './security';

export interface PdfLockInfo {
  /** has an /Encrypt dictionary, with or without an open password */
  encrypted: boolean;
  /** what the file stops people doing, e.g. ["printing", "copying"] */
  restrictions: string[];
  /** small first-page preview; the caller revokes it */
  thumb?: string;
}

/** Reads a PDF's encryption and permissions and draws a thumbnail, then closes the doc */
export async function inspectPdf(doc: PdfDoc): Promise<PdfLockInfo> {
  try {
    const [allowed, meta] = await Promise.all([doc.proxy.getPermissions(), doc.proxy.getMetadata()]);
    const filter = (meta.info as { EncryptFilterName?: string | null }).EncryptFilterName;
    let thumb: string | undefined;
    try {
      const canvas = await renderPage(doc, 0, { width: 120, height: 160 });
      thumb = URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg', 0.82));
      canvas.width = 0;
    } catch {
      // the preview is a nicety; the file itself can still be processed
    }
    return { encrypted: filter != null || allowed !== null, restrictions: describeRestrictions(allowed), thumb };
  } finally {
    void doc.destroy();
  }
}

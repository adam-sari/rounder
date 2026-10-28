import { PdfError } from './errors';

/*
 * Where the PDF fonts come from: /fonts/pdf/ on the site. A leaf of its own so the npm packages can swap it for one
 * that reads the same files from disk.
 */

/** Noto Sans (OFL), Latin + Latin Extended + Greek + Cyrillic */
export type PdfFontFile = 'NotoSans-Regular.ttf' | 'NotoSans-Bold.ttf';

export async function loadPdfFontBytes(file: PdfFontFile): Promise<Uint8Array> {
  const r = await fetch(`${import.meta.env.BASE_URL}fonts/pdf/${file}`);
  if (!r.ok) throw new PdfError("The font for non-Latin text couldn't be loaded. Check your connection and try again.");
  return new Uint8Array(await r.arrayBuffer());
}

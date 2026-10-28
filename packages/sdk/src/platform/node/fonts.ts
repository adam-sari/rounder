import { readFile } from 'node:fs/promises';
import { assetPath } from './assets';

/** Node twin of src/engines/pdf/fonts.ts: the same Noto Sans files, from the package's assets folder */
export type PdfFontFile = 'NotoSans-Regular.ttf' | 'NotoSans-Bold.ttf';

export async function loadPdfFontBytes(file: PdfFontFile): Promise<Uint8Array> {
  return new Uint8Array(await readFile(assetPath('fonts', file)));
}

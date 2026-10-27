import * as Comlink from 'comlink';
import { abortError, canvasToBlob, DAMAGED, loadPdfjs, PdfError, runQpdf, type PdfDoc } from '@/engines/pdf';
import type { FoundImage } from './extract';
import type { PdfImagesWorker, ScanStatus } from './worker';

export type { FoundImage };

/** One scan in a fresh worker, torn down after so pdf-lib's copy of a big file is freed */
async function scanOnce(bytes: Uint8Array, onProgress: (done: number, total: number) => void, onImage: (image: FoundImage) => void, signal: AbortSignal): Promise<ScanStatus> {
  // an 'abort' listener never fires for a signal that's already aborted (e.g. during the qpdf pass)
  if (signal.aborted) throw abortError();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'pdf-images' });
  const api = Comlink.wrap<PdfImagesWorker>(worker);
  try {
    return await new Promise<ScanStatus>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
      worker.addEventListener('error', () => reject(new PdfError("The image extractor couldn't start. Reload the page and try again.")));
      api.scan(Comlink.transfer(bytes, [bytes.buffer]), Comlink.proxy(onProgress), Comlink.proxy(async (image: FoundImage) => onImage(image))).then(resolve, reject);
    });
  } catch (e) {
    if (e instanceof PdfError || (e as Error)?.name === 'AbortError') throw e;
    // the worker itself died, most likely out of memory on a huge file
    throw new PdfError(`The images couldn't be extracted (${(e as Error)?.message ?? e}).`);
  } finally {
    api[Comlink.releaseProxy]();
    worker.terminate();
  }
}

/**
 * Streams every distinct image in the PDF to `onImage`. Encrypted files are
 * decrypted and unreadable ones get one repair pass, both with qpdf, first.
 */
export async function extractImages(
  file: File,
  { password, signal, onProgress, onImage }: { password?: string; signal: AbortSignal; onProgress: (done: number, total: number) => void; onImage: (image: FoundImage) => void },
): Promise<void> {
  const read = async () => new Uint8Array(await file.arrayBuffer());
  let status = await scanOnce(await read(), onProgress, onImage, signal);
  if (status === 'encrypted') status = await scanOnce(await runQpdf(['--decrypt', 'in.pdf', 'out.pdf'], await read(), { password }), onProgress, onImage, signal);
  else if (status === 'damaged') {
    let repaired: Uint8Array;
    try {
      repaired = await runQpdf(['in.pdf', 'out.pdf'], await read());
    } catch {
      throw new PdfError(DAMAGED, 'damaged');
    }
    status = await scanOnce(repaired, onProgress, onImage, signal);
  }
  if (status !== 'ok') throw new PdfError(DAMAGED, 'damaged');
}

/* ---------------- pdf.js fallback ---------------- */

interface PdfjsImage {
  width: number;
  height: number;
  /** 1 = 1-bit gray (set bits are white), 2 = RGB, 3 = RGBA */
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
}

function objectOf(page: Awaited<ReturnType<PdfDoc['getPage']>>, id: string): Promise<PdfjsImage> {
  const store = id.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for the image')), 20_000);
    store.get(id, (data: PdfjsImage) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function toRgba({ width, height, kind, data }: PdfjsImage): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  if (!data) throw new Error('No image data');
  if (kind === 3) out.set(data.subarray(0, out.length));
  else if (kind === 2) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      out[i * 4] = data[j];
      out[i * 4 + 1] = data[j + 1];
      out[i * 4 + 2] = data[j + 2];
      out[i * 4 + 3] = 255;
    }
  } else {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
        out.fill(v, (y * width + x) * 4, (y * width + x) * 4 + 3);
        out[(y * width + x) * 4 + 3] = 255;
      }
    }
  }
  return out;
}

/**
 * Decodes images our own code can't (JPEG 2000, JBIG2, CCITT, CMYK, Lab…) with
 * pdf.js, matching each by its page and size, and saves them as PNG.
 * Resolves with one Blob (or null when it couldn't be found) per wanted image.
 */
export async function drawWithPdfjs(doc: PdfDoc, wanted: { pageIndex: number; width: number; height: number }[], signal: AbortSignal): Promise<(Blob | null)[]> {
  const { OPS } = await loadPdfjs();
  const out: (Blob | null)[] = wanted.map(() => null);
  const pages = [...new Set(wanted.map((w) => w.pageIndex))];
  for (const pageIndex of pages) {
    if (signal.aborted) throw abortError();
    const page = await doc.getPage(pageIndex);
    try {
      const ops = await page.getOperatorList();
      // paintImageXObject's arguments are [objId, width, height]
      const painted = ops.fnArray.flatMap((fn, i) => (fn === OPS.paintImageXObject ? [ops.argsArray[i] as [string, number, number]] : []));
      const used = new Set<string>();
      for (const [i, w] of wanted.entries()) {
        if (w.pageIndex !== pageIndex) continue;
        const hit = painted.find(([id, pw, ph]) => pw === w.width && ph === w.height && !used.has(id));
        if (!hit) continue;
        used.add(hit[0]);
        try {
          const img = await objectOf(page, hit[0]);
          const canvas = document.createElement('canvas');
          canvas.width = img.bitmap?.width ?? img.width;
          canvas.height = img.bitmap?.height ?? img.height;
          const ctx = canvas.getContext('2d')!;
          if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
          else ctx.putImageData(new ImageData(toRgba(img), img.width, img.height), 0, 0);
          out[i] = await canvasToBlob(canvas, 'image/png');
          canvas.width = 0;
        } catch (e) {
          console.warn(`Image on page ${pageIndex + 1}:`, e);
        }
      }
    } finally {
      page.cleanup();
    }
  }
  return out;
}

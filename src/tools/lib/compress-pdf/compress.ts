import * as Comlink from 'comlink';
import { encodeImage } from '@/engines/image/client';
import { abortError, DAMAGED, PdfError, runQpdf } from '@/engines/pdf';
import type { CompressWorker, Host, ImagePassResult } from './compress.worker';
import type { ImageStats } from './images';
import { imageOptions, type CompressSettings, type ImageOptions } from './settings';

export type Progress = { stage: 'images'; done: number; total: number } | { stage: 'optimize' };

export interface CompressResult {
  blob: Blob;
  /** the result wasn't smaller, so this is the original file */
  kept: boolean;
  images: ImageStats | null;
  /** the input was encrypted; the output is not */
  decrypted: boolean;
}

/** lossless: pack objects into compressed streams and squeeze every flate stream */
const LOSSLESS = ['--decrypt', '--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9'];

/** pdf-lib in a worker of its own, so a cancelled job can simply be terminated */
async function imagePass(bytes: Uint8Array, options: ImageOptions, signal: AbortSignal, onprogress: (p: Progress) => void): Promise<ImagePassResult> {
  const worker = new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module', name: 'compress-pdf' });
  const api = Comlink.wrap<CompressWorker>(worker);
  const host: Host = {
    async encode(img, quality) {
      const buffer = await (await encodeImage(img, { format: 'jpeg', quality, progressive: false })).arrayBuffer();
      return Comlink.transfer(buffer, [buffer]);
    },
    progress: (done, total) => onprogress({ stage: 'images', done, total }),
  };
  let onabort = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onabort = () => reject(abortError());
    signal.addEventListener('abort', onabort, { once: true });
    // fires when the worker fails to load or dies mid-job (e.g. out of memory)
    worker.addEventListener('error', () => reject(new PdfError('The image compressor stopped unexpectedly. Try the Light level, or reload the page and try again.')));
  });
  try {
    const copy = bytes.slice(); // the caller keeps its bytes for the qpdf pass
    return await Promise.race([api.run(Comlink.transfer(copy, [copy.buffer]), options, Comlink.proxy(host)), stopped]);
  } catch (e) {
    if (signal.aborted || e instanceof PdfError) throw e;
    // pdf-lib or the browser ran out of room on a huge file
    throw new PdfError(`The images in this PDF couldn't be compressed (${(e as Error)?.message ?? e}). Try the Light level.`);
  } finally {
    signal.removeEventListener('abort', onabort);
    worker.terminate();
  }
}

/**
 * Compresses one PDF: recompresses its photos (unless the level is Light), then
 * a lossless qpdf pass. Never returns a bigger file unless metadata removal or
 * grayscale was asked for, since keeping the original would undo that.
 */
export async function compressPdf(
  file: File,
  settings: CompressSettings,
  { password, signal, onprogress }: { password?: string; signal: AbortSignal; onprogress: (p: Progress) => void },
): Promise<CompressResult> {
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  let decrypted = !!password;
  let images: ImageStats | null = null;
  const check = () => {
    if (signal.aborted) throw abortError();
  };

  const options = imageOptions(settings);
  if (options) {
    // pdf-lib can't decrypt: qpdf opens the file first when it's locked
    if (password) bytes = await runQpdf(['--decrypt', 'in.pdf', 'out.pdf'], bytes, { password });
    check();
    let r = await imagePass(bytes, options, signal, onprogress);
    if (r.status !== 'ok') {
      // permissions-only encryption needs no password; anything else gets a qpdf repair pass
      decrypted ||= r.status === 'encrypted';
      bytes = await runQpdf(r.status === 'encrypted' ? ['--decrypt', 'in.pdf', 'out.pdf'] : ['in.pdf', 'out.pdf'], bytes);
      check();
      r = await imagePass(bytes, options, signal, onprogress);
      if (r.status !== 'ok') throw new PdfError(DAMAGED, 'damaged');
    }
    images = r.stats;
    if (r.bytes) bytes = r.bytes;
  }

  check();
  onprogress({ stage: 'optimize' });
  const strip = settings.stripMetadata ? ['--remove-info', '--remove-metadata'] : [];
  // the password is only needed when the image pass didn't already decrypt
  const out = await runQpdf([...LOSSLESS, ...strip, 'in.pdf', 'out.pdf'], bytes, { password: options ? undefined : password });
  check();

  const asked = settings.stripMetadata || (!!options?.grayscale && !!images?.replaced);
  if (out.length >= file.size && !asked) return { blob: file, kept: true, images, decrypted: false };
  return { blob: new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), kept: false, images, decrypted };
}

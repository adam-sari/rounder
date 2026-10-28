import * as Comlink from 'comlink';
import { encodeImage } from '@/engines/image/client';
import { abortError, PdfError } from '@/engines/pdf';
import type { CompressWorker, Host, ImagePassResult, SampleResult } from './compress.worker';
import type { ImageOptions } from './settings';

/*
 * How compress.ts runs the image pass: pdf-lib in a worker of its own, JPEG encoding in the shared image engine. A
 * leaf of its own so the npm packages can swap it for an in-process runner while compress.ts stays shared.
 */

/** pdf-lib in a worker of its own, so a cancelled job can simply be terminated */
async function inWorker<T>(signal: AbortSignal, progress: (done: number, total: number) => void, call: (api: Comlink.Remote<CompressWorker>, host: Host) => Promise<T>): Promise<T> {
  const worker = new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module', name: 'compress-pdf' });
  const api = Comlink.wrap<CompressWorker>(worker);
  const host: Host = {
    async encode(img, quality) {
      const buffer = await (await encodeImage(img, { format: 'jpeg', quality, progressive: false })).arrayBuffer();
      return Comlink.transfer(buffer, [buffer]);
    },
    progress,
  };
  let onabort = () => {};
  const stopped = new Promise<never>((_, reject) => {
    onabort = () => reject(abortError());
    signal.addEventListener('abort', onabort, { once: true });
    // fires when the worker fails to load or dies mid-job (e.g. out of memory)
    worker.addEventListener('error', () => reject(new PdfError('The image compressor stopped unexpectedly. Try the Light level, or reload the page and try again.')));
  });
  try {
    return await Promise.race([call(api, Comlink.proxy(host)), stopped]);
  } catch (e) {
    if (signal.aborted || e instanceof PdfError) throw e;
    // pdf-lib or the browser ran out of room on a huge file
    throw new PdfError(`The images in this PDF couldn't be compressed (${(e as Error)?.message ?? e}). Try the Light level.`);
  } finally {
    signal.removeEventListener('abort', onabort);
    worker.terminate();
  }
}

// the caller keeps its bytes for the qpdf pass, so the worker gets a copy
const copyOf = (bytes: Uint8Array) => {
  const copy = bytes.slice();
  return Comlink.transfer(copy, [copy.buffer]);
};

/** recompresses the photos in `bytes` with `options` */
export const runImagePass = (bytes: Uint8Array, options: ImageOptions, signal: AbortSignal, progress: (done: number, total: number) => void) =>
  inWorker<ImagePassResult>(signal, progress, (api, host) => api.run(copyOf(bytes), options, host));

/** tries each setting on a few photos, for a target-size estimate */
export const runSample = (bytes: Uint8Array, settings: ImageOptions[], signal: AbortSignal, progress: (done: number, total: number) => void) =>
  inWorker<SampleResult>(signal, progress, (api, host) => api.sample(copyOf(bytes), settings, host));

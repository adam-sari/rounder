import * as Comlink from 'comlink';
import { encodeImage } from '@/engines/image/client';
import { abortError, DAMAGED, PdfError, runQpdf } from '@/engines/pdf';
import type { CompressWorker, Host, ImagePassResult, SampleResult } from './compress.worker';
import type { ImageStats } from './images';
import { imageOptions, type CompressSettings, type ImageOptions } from './settings';
import { estimateSizes, LADDER, missReason, searchLadder, type Rung } from './target';

export type Progress =
  | { stage: 'images'; done: number; total: number; /** target mode: which full pass, at which setting */ attempt?: number; rung?: Rung }
  | { stage: 'estimate'; done: number; total: number }
  | { stage: 'optimize' };

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

const imagePass = (bytes: Uint8Array, options: ImageOptions, signal: AbortSignal, onprogress: (p: Progress) => void, extra: { attempt?: number; rung?: Rung } = {}) =>
  inWorker<ImagePassResult>(signal, (done, total) => onprogress({ stage: 'images', done, total, ...extra }), (api, host) => api.run(copyOf(bytes), options, host));

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

export interface TargetResult extends CompressResult {
  fits: boolean;
  /** the setting the photos ended up at; null when the lossless pass alone was enough */
  rung: Rung | null;
  /** full passes it took */
  attempts: number;
  /** when it doesn't fit: why, how many parts a split needs, and whether grayscale could still help */
  miss?: { why: string; parts: number; grayscale: boolean };
}

/**
 * Compresses one PDF to at most `target` bytes with the sharpest photos that fit. A lossless pass goes first (when it
 * already fits, photos are left alone); then a sample of the photos is tried at every rung of LADDER to estimate the
 * result, and full passes run only where the estimate says the target is reachable, three at most.
 */
export async function compressToTarget(
  file: File,
  target: number,
  { grayscale, stripMetadata }: Pick<CompressSettings, 'grayscale' | 'stripMetadata'>,
  { password, signal, onprogress }: { password?: string; signal: AbortSignal; onprogress: (p: Progress) => void },
): Promise<TargetResult> {
  const check = () => {
    if (signal.aborted) throw abortError();
  };
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  let decrypted = !!password;
  if (password) bytes = await runQpdf(['--decrypt', 'in.pdf', 'out.pdf'], bytes, { password });
  check();
  const strip = stripMetadata ? ['--remove-info', '--remove-metadata'] : [];
  const optimize = (b: Uint8Array) => runQpdf([...LOSSLESS, ...strip, 'in.pdf', 'out.pdf'], b);
  const pdf = (b: Uint8Array) => new Blob([b as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });

  onprogress({ stage: 'optimize' });
  const lossless = await optimize(bytes);
  check();
  // the untouched file wins when it's smaller, unless something was asked of it
  const plain = lossless.length < file.size || stripMetadata || decrypted ? { blob: pdf(lossless), kept: false } : { blob: file, kept: true };
  if (plain.blob.size <= target && !grayscale) return { ...plain, images: null, decrypted: decrypted && !plain.kept, fits: true, rung: null, attempts: 0 };

  const settings = LADDER.map((r) => ({ ...r, grayscale }));
  const sample = (b: Uint8Array) =>
    inWorker<SampleResult>(signal, (done, total) => onprogress({ stage: 'estimate', done, total }), (api, host) => api.sample(copyOf(b), settings, host));
  let s = await sample(bytes);
  if (s.status !== 'ok') {
    // permissions-only encryption needs no password; anything else gets a qpdf repair pass
    decrypted ||= s.status === 'encrypted';
    bytes = await runQpdf(s.status === 'encrypted' ? ['--decrypt', 'in.pdf', 'out.pdf'] : ['in.pdf', 'out.pdf'], bytes);
    check();
    s = await sample(bytes);
    if (s.status !== 'ok') throw new PdfError(DAMAGED, 'damaged');
  }
  check();
  const { candidates, candidateBytes, samples } = s.sample;
  // every sampled photo failed to decode or redraw (e.g. no OffscreenCanvas in workers): full passes can't do better
  const unreadable = samples.length > 0 && s.sample.unreadable === samples.length;
  const reason = (size: number) => ({
    ...missReason({ target, size, lossless: lossless.length, candidateBytes, candidates, grayscale, unreadable }),
    grayscale: !grayscale && candidates > 0 && !unreadable,
  });
  if (!candidates || unreadable) {
    const fits = plain.blob.size <= target;
    return { ...plain, images: null, decrypted: decrypted && !plain.kept, fits, rung: null, attempts: 0, miss: fits ? undefined : reason(plain.blob.size) };
  }

  const search = await searchLadder(target, estimateSizes(s.sample, lossless.length), async (i, attempt) => {
    const r = await imagePass(bytes, settings[i], signal, onprogress, { attempt, rung: LADDER[i] });
    if (r.status !== 'ok') throw new PdfError(DAMAGED, 'damaged');
    check();
    onprogress({ stage: 'optimize' });
    const out = await optimize(r.bytes ?? bytes);
    check();
    return { size: out.length, out: { out, stats: r.stats } };
  });
  const { best, fits, tries } = search;
  // a miss still hands back the smallest file it made, or the lossless one when the photos didn't help
  if (!fits && plain.blob.size <= best.size && !grayscale) return { ...plain, images: null, decrypted: decrypted && !plain.kept, fits: false, rung: null, attempts: tries.length, miss: reason(plain.blob.size) };
  return {
    blob: pdf(best.out.out),
    kept: false,
    images: best.out.stats,
    decrypted,
    fits,
    rung: LADDER[best.rung],
    attempts: tries.length,
    miss: fits ? undefined : reason(best.size),
  };
}

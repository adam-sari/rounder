import * as Comlink from 'comlink';
import { abortError, DAMAGED, isAbort, PdfError, runQpdf } from '@/engines/pdf';
import type { SplitWorker } from './worker';

export interface SizedPart {
  indices: number[];
  bytes: Uint8Array;
  /** a single page that's over the limit on its own */
  over: boolean;
}

function friendly(e: unknown): PdfError {
  if (e instanceof PdfError) return e;
  const msg = (e as Error)?.message ?? String(e);
  // errors from the worker arrive as plain Errors that keep their name
  if ((e as Error)?.name === 'RangeError' || /allocat|out of memory/i.test(msg)) {
    return new PdfError("This file is too big to split in your browser's memory. Try closing other tabs and trying again.");
  }
  return new PdfError(`The PDF couldn't be split (${msg}).`);
}

/**
 * One PDF loaded into pdf-lib in a worker of its own. Encrypted files are
 * decrypted and unreadable ones get one repair pass through qpdf first, the
 * same way loadEditablePdf does it, but without parsing on the main thread.
 */
export class Splitter {
  #worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'split-pdf' });
  #api = Comlink.wrap<SplitWorker>(this.#worker);
  #failed: Promise<never>;
  #stop!: (e: Error) => void;
  readonly ready: Promise<void>;

  /** `numPages` is what pdf.js found, so the copied pages match the thumbnails */
  constructor(file: File, numPages: number, password?: string) {
    // a worker that fails to load, or is stopped, never answers: settle its calls instead of hanging
    this.#failed = new Promise((_, reject) => (this.#stop = reject));
    this.#worker.addEventListener('error', () => this.#stop(new PdfError("The PDF engine couldn't start. Reload the page and try again.")));
    this.#failed.catch(() => {});
    this.ready = this.#run(this.#load(file, numPages, password));
    this.ready.catch(() => {});
  }

  async #load(file: File, numPages: number, password?: string) {
    const state = await this.#api.open(file, numPages);
    if (state === 'ok') return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fixed = await runQpdf(state === 'encrypted' ? ['--decrypt', 'in.pdf', 'out.pdf'] : ['in.pdf', 'out.pdf'], bytes, { password });
    if ((await this.#api.open(Comlink.transfer(fixed, [fixed.buffer as ArrayBuffer]), numPages)) !== 'ok') throw new PdfError(DAMAGED, 'damaged');
  }

  async #run<T>(job: Promise<T>): Promise<T> {
    try {
      return await Promise.race([job, this.#failed]);
    } catch (e) {
      throw isAbort(e) ? e : friendly(e);
    }
  }

  async build(indices: number[]): Promise<Uint8Array> {
    await this.ready;
    return this.#run(this.#api.build(indices));
  }

  /** `guess` is how many pages to try in the first file */
  async bySize(limit: number, guess: number, onProgress: (pagesDone: number) => void): Promise<SizedPart[]> {
    await this.ready;
    const parts = await this.#run(this.#api.bySize(limit, guess, Comlink.proxy(onProgress)));
    return parts.map((p) => ({ indices: Array.from({ length: p.end - p.start }, (_, k) => p.start + k), bytes: p.bytes, over: p.over }));
  }

  zip(files: { name: string; data: Blob }[]): Promise<Uint8Array> {
    return this.#run(this.#api.zip(files));
  }

  /** stops any job in progress (it rejects with an AbortError) and frees the worker's copy of the PDF */
  dispose() {
    this.#worker.terminate();
    this.#stop(abortError());
  }
}

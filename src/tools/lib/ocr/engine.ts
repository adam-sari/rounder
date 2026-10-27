import type Tesseract from 'tesseract.js';
import { aiError, toAiError } from '@/engines/ai/errors';
import { ProgressTally, type OnProgress } from '@/engines/ai/progress';
import { tesseractPaths } from '@/engines/ai/runtime';
import { getLanguage, LANGUAGE_BASE, languageUrl, TESSDATA } from './languages';

/*
 * Tesseract (tesseract.js 7, self-hosted core) in its own Web Worker(s).
 *
 * Language data: we download it ourselves (byte progress, cancel) and store it where
 * tesseract.js's worker looks first: its IndexedDB cache (idb-keyval's default "keyval-store"),
 * under a cachePath of our own. tesseract.js 7 can't take the bytes directly (its initialize
 * step joins `Lang.data` into the language string), and if our copy is missing it simply
 * fetches the same pinned file itself.
 */

const CACHE_PATH = `rounder-ocr/tessdata_fast-${TESSDATA.revision.slice(0, 8)}`;
const LSTM_ONLY = 1;

/** what the worker downloads once: its script plus the LSTM-only core (/vendor/tesseract, about the same for every SIMD level) */
export const ENGINE_BYTES = 4.0e6;

// ── IndexedDB, laid out exactly like idb-keyval's default store ──

let db: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('keyval-store');
    req.onupgradeneeded = () => req.result.createObjectStore('keyval');
    req.onsuccess = () => {
      req.result.onclose = () => (db = undefined);
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    db = undefined;
    throw e;
  });
  return db;
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await openDb()).transaction('keyval', mode).objectStore('keyval');
  const req = run(store);
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dataKey = (code: string) => `${CACHE_PATH}/${code}.traineddata`;

/** The languages (of those asked) already on this device */
export async function cachedLanguages(codes: readonly string[]): Promise<Set<string>> {
  try {
    const keys = await idb('readonly', (s) => s.getAllKeys());
    const have = new Set(keys.map(String));
    return new Set(codes.filter((c) => have.has(dataKey(c))));
  } catch {
    // private windows and some embedded browsers have no IndexedDB
    return new Set();
  }
}

/** Downloads the languages that aren't cached yet, with one combined byte progress */
async function downloadLanguages(codes: readonly string[], onProgress: OnProgress | undefined, signal: AbortSignal | undefined) {
  const have = await cachedLanguages(codes);
  const missing = codes.filter((c) => !have.has(c));
  const tally = new ProgressTally(Object.fromEntries(missing.map((c) => [c, getLanguage(c)?.bytes ?? 0])));
  if (missing.length) onProgress?.(tally.sum());
  await Promise.all(
    missing.map(async (code) => {
      const res = await fetch(languageUrl(code), { signal, mode: 'cors', credentials: 'omit' });
      if (res.status === 429) throw aiError('rate-limited');
      if (!res.ok || !res.body) throw aiError('network', new Error(`HTTP ${res.status} for ${code}`));
      // jsDelivr sends it brotli-compressed, so Content-Length is not the size we read: count bytes ourselves
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress?.(tally.update(code, loaded));
      }
      const data = new Uint8Array(loaded);
      let at = 0;
      for (const c of chunks) data.set(c, (at += c.length) - c.length);
      // a full or blocked store isn't fatal: the worker then fetches the file itself (from the HTTP cache)
      await idb('readwrite', (s) => s.put(data, dataKey(code))).catch(() => {});
    }),
  );
}

// ── consent: asked once for OCR as a whole; languages then download as they're picked ──

const CONSENT_KEY = 'rounder:ocr-consent';

export function hasOcrConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === TESSDATA.revision;
  } catch {
    return false;
  }
}

export function rememberOcrConsent(): void {
  try {
    localStorage.setItem(CONSENT_KEY, TESSDATA.revision);
  } catch {
    // blocked storage: we'll ask again next time
  }
}

// ── the engine ──

export interface RecognizeJob {
  /** encoded image (PGM from toPgm, or PNG/JPEG/WebP/BMP bytes) */
  image: Uint8Array;
  /** Tesseract parameters for this image, e.g. { user_defined_dpi: '300' } */
  params?: Record<string, string>;
  /** word boxes (blocks); off for text-only jobs */
  layout?: boolean;
  /** an invisible-text PDF page (text only, no image) for overlaying on a scan */
  pdf?: boolean;
  /** recognition progress 0–1 */
  onProgress?: (fraction: number) => void;
}

export interface OcrEngine {
  /** "eng+deu" */
  readonly langs: string;
  recognize(job: RecognizeJob, signal?: AbortSignal): Promise<Tesseract.Page>;
  terminate(): void;
}

type TesseractModule = typeof Tesseract;

async function loadTesseract(): Promise<TesseractModule> {
  const m = await import('tesseract.js');
  // CommonJS: the namespace may arrive as the default export
  return (m as unknown as { default?: TesseractModule }).default ?? (m as unknown as TesseractModule);
}

/**
 * Downloads the languages (once), then starts `workers` Tesseract workers with them.
 * Progress: 'download' with bytes, then 'init' while the engine starts.
 */
export async function createOcrEngine(
  codes: readonly string[],
  { workers = 1, onProgress, signal }: { workers?: number; onProgress?: OnProgress; signal?: AbortSignal } = {},
): Promise<OcrEngine> {
  const pool: Promise<Tesseract.Worker>[] = [];
  const stopAll = () => pool.forEach((p) => p.then((w) => w.terminate(), () => {}));
  try {
    const [T] = await Promise.all([loadTesseract(), downloadLanguages(codes, onProgress, signal)]);
    if (signal?.aborted) throw aiError('aborted');
    onProgress?.({ phase: 'init', loaded: 0, total: 0 });
    const listeners: (((p: number) => void) | undefined)[] = [];
    const spawn = (i: number) => {
      const worker = new Promise<Tesseract.Worker>((resolve, reject) => {
        T.createWorker([...codes], LSTM_ONLY, {
          ...tesseractPaths(),
          langPath: LANGUAGE_BASE,
          cachePath: CACHE_PATH,
          gzip: false,
          logger: (m) => m.status === 'recognizing text' && listeners[i]?.(m.progress),
          // tesseract.js reports failures here (its own promise can hang when a language fails to load)
          errorHandler: (e: unknown) => reject(new Error(String(e))),
        }).then(resolve, reject);
      });
      worker.catch(() => {}); // surfaces on the next recognize instead
      return (pool[i] = worker);
    };
    // a terminated tesseract.js worker never settles its start promise, so cancelling has to end the wait itself
    let onAbort = () => {};
    const cancelled = new Promise<never>((_, reject) => (onAbort = () => (stopAll(), reject(aiError('aborted')))));
    cancelled.catch(() => {});
    signal?.addEventListener('abort', onAbort, { once: true });
    await Promise.race([Promise.all(Array.from({ length: Math.max(1, workers) }, (_, i) => spawn(i))), cancelled]).finally(() =>
      signal?.removeEventListener('abort', onAbort),
    );
    return pooled(pool, spawn, listeners, codes.join('+'), stopAll);
  } catch (e) {
    stopAll();
    throw toAiError(signal?.aborted ? aiError('aborted') : e);
  }
}

/** Hands jobs to free workers; a cancelled job ends its worker and a fresh one takes its place */
function pooled(
  pool: Promise<Tesseract.Worker>[],
  spawn: (i: number) => Promise<Tesseract.Worker>,
  listeners: (((p: number) => void) | undefined)[],
  langs: string,
  stopAll: () => void,
): OcrEngine {
  const idle = pool.map((_, i) => i);
  const waiting: { resolve: (i: number) => void; reject: (e: unknown) => void }[] = [];
  /** rejecters of the jobs running now, for terminate() */
  const running = new Set<() => void>();
  let dead = false;
  const take = () => (idle.length ? Promise.resolve(idle.pop()!) : new Promise<number>((resolve, reject) => waiting.push({ resolve, reject })));
  const give = (i: number) => (waiting.length ? waiting.shift()!.resolve(i) : idle.push(i));

  return {
    langs,
    terminate() {
      dead = true;
      stopAll();
      waiting.splice(0).forEach((w) => w.reject(aiError('aborted')));
      running.forEach((stop) => stop());
    },
    async recognize({ image, params = {}, layout = false, pdf = false, onProgress }, signal) {
      if (dead || signal?.aborted) throw aiError('aborted');
      const i = await take();
      if (signal?.aborted) {
        give(i);
        throw aiError('aborted');
      }
      listeners[i] = onProgress;
      let stop = () => {};
      let onAbort = () => {};
      const replace = () => {
        void pool[i].then((w) => w.terminate(), () => {});
        if (!dead) spawn(i);
      };
      try {
        const worker = await pool[i];
        const job = worker.recognize(image as unknown as Tesseract.ImageLike, { ...params, pdfTextOnly: pdf } as Partial<Tesseract.RecognizeOptions>, { text: true, blocks: layout, pdf });
        const stopped = new Promise<never>((_, reject) => (stop = () => reject(aiError('aborted'))));
        running.add(stop);
        // a running recognition can only be stopped by ending its worker; a fresh one takes its place
        onAbort = () => {
          replace();
          stop();
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const { data } = await Promise.race([job, stopped]);
        return data;
      } catch (e) {
        // a worker that failed to start or crashed (wasm out of memory leaves it unusable) is replaced too,
        // so one bad image doesn't fail every job after it
        if (!dead && !signal?.aborted) replace();
        throw e instanceof Error ? e : new Error(String(e));
      } finally {
        running.delete(stop);
        signal?.removeEventListener('abort', onAbort);
        listeners[i] = undefined;
        if (!dead) give(i);
      }
    },
  };
}

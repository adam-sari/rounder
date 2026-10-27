import { abortError } from '@/engines/pdf/errors';
import type { Raster } from './pixels';
import type { TextComparison, TextOptions } from './text';
import type { CompareRequest } from './worker';

/** One worker and its pending calls. Text and pixels get one each, so a long diff never holds up page scans */
function lane() {
  let worker: Worker | undefined;
  let next = 0;
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: unknown) => void }>();

  const reset = (err: unknown) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };

  return {
    call<T>(req: CompareRequest, transfer: Transferable[] = []): Promise<T> {
      if (!worker) {
        worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
          const p = pending.get(e.data.id);
          pending.delete(e.data.id);
          if (e.data.error === undefined) p?.resolve(e.data.result as never);
          else p?.reject(new Error(e.data.error));
        };
        worker.onerror = (e) => reset(new Error(e.message || 'Comparing failed.'));
      }
      const id = ++next;
      const promise = new Promise<T>((resolve, reject) => pending.set(id, { resolve, reject }));
      worker.postMessage({ id, req }, transfer);
      return promise;
    },
    /** rejects pending calls with an AbortError and stops whatever is running */
    stop: () => reset(abortError()),
  };
}

const text = lane();
const pixels = lane();

/** Diffs every page off the main thread. A new call replaces one still running. */
export function compareTextsOff(a: string[], b: string[], options: TextOptions) {
  // a long diff can't be interrupted from inside, so its worker goes and a fresh one starts
  text.stop();
  return text.call<TextComparison>({ kind: 'text', a, b, options });
}

/** Number of differing pixels. The rasters' buffers are handed over to the worker. */
export const countChangedOff = (a: Raster, b: Raster) => pixels.call<number>({ kind: 'count', a, b }, [a.data.buffer, b.data.buffer]);

export const highlightOff = (a: Raster, b: Raster) => pixels.call<Raster & { changed: number }>({ kind: 'highlight', a, b }, [a.data.buffer, b.data.buffer]);

export function closeCompare() {
  text.stop();
  pixels.stop();
}

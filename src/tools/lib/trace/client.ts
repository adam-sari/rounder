import type { TraceResult, TraceSettings } from './settings';
import type { TraceRequest } from './worker';

let worker: Worker | undefined;
let cancel: (() => void) | undefined;

/** Stops a trace in progress; its promise rejects with an AbortError */
export function stopTracing() {
  if (!cancel) return;
  cancel();
  cancel = undefined;
  // a long trace can't be interrupted from inside, so the worker goes and a fresh one starts next time
  worker?.terminate();
  worker = undefined;
}

/** Stops any trace and shuts the worker down, e.g. when the tool goes away */
export function closeTracer() {
  stopTracing();
  worker?.terminate();
  worker = undefined;
}

/** Traces off the main thread. A new call replaces one still running. */
export function trace(image: ImageData, settings: TraceSettings, out: { width: number; height: number }): Promise<TraceResult> {
  stopTracing();
  const w = (worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  // copy, so the caller's pixels survive the transfer and the in-place edits
  const data = new Uint8ClampedArray(image.data);
  return new Promise((resolve, reject) => {
    cancel = () => reject(new DOMException('Superseded', 'AbortError'));
    w.onmessage = (e: MessageEvent<{ result?: TraceResult; error?: string }>) => {
      cancel = undefined;
      if (e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      cancel = undefined;
      worker = undefined;
      w.terminate();
      reject(new Error(e.message || 'Tracing failed.'));
    };
    const request: TraceRequest = { image: { width: image.width, height: image.height, data }, settings, out };
    w.postMessage(request, [data.buffer]);
  });
}

import type { MinifyRequest, MinifyResponse } from './worker';

let worker: Worker | undefined;
let cancel: (() => void) | undefined;

/** Shuts the worker down, e.g. when the tool goes away; a run in progress rejects with an AbortError */
export function closeMinifier() {
  cancel?.();
  cancel = undefined;
  worker?.terminate();
  worker = undefined;
}

/** Minifies off the main thread. A new call replaces one still running. */
export function minifyCode(request: MinifyRequest): Promise<MinifyResponse> {
  // a big minify can't be interrupted from inside, so a busy worker is replaced
  if (cancel) closeMinifier();
  const w = (worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
  return new Promise((resolve, reject) => {
    cancel = () => reject(new DOMException('Superseded', 'AbortError'));
    w.onmessage = (e: MessageEvent<MinifyResponse>) => {
      cancel = undefined;
      resolve(e.data);
    };
    w.onerror = (e) => {
      cancel = undefined;
      worker = undefined;
      w.terminate();
      reject(new Error(e.message || 'The minifier stopped unexpectedly.'));
    };
    w.postMessage(request);
  });
}

import type { DiffOptions, DiffResult } from './diff';
import type { DiffRequest } from './worker';

let worker: Worker | undefined;
let cancel: (() => void) | undefined;

const spawn = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

function run<T>(w: Worker, request: DiffRequest, onSettle: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    if (w === worker) cancel = () => reject(new DOMException('Superseded', 'AbortError'));
    w.onmessage = (e: MessageEvent<{ result?: T; error?: string }>) => {
      onSettle();
      if (e.data.error === undefined) resolve(e.data.result as T);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      onSettle();
      w.terminate();
      if (w === worker) worker = undefined;
      reject(new Error(e.message || 'Comparing failed.'));
    };
    w.postMessage(request);
  });
}

/** Diffs off the main thread. A new call replaces one still running. */
export function diffTexts(a: string, b: string, options: DiffOptions): Promise<DiffResult> {
  if (cancel) {
    // a long diff can't be interrupted from inside, so the worker goes and a fresh one starts
    cancel();
    worker?.terminate();
    worker = undefined;
  }
  const w = (worker ??= spawn());
  return run<DiffResult>(w, { kind: 'diff', a, b, options }, () => (cancel = undefined));
}

/** Builds a unified patch in its own short-lived worker, so it never holds up the live diff */
export function patchTexts(a: string, b: string, nameA: string, nameB: string): Promise<string> {
  const w = spawn();
  return run<string>(w, { kind: 'patch', a, b, nameA, nameB }, () => w.terminate());
}

export function closeDiffer() {
  cancel?.();
  cancel = undefined;
  worker?.terminate();
  worker = undefined;
}

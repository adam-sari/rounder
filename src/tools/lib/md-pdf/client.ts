import * as Comlink from 'comlink';
import type { MdPdfWorker } from './worker';

let worker: Worker | undefined;
let api: Comlink.Remote<MdPdfWorker> | undefined;

/**
 * The parse/layout/PDF worker, started on first use. A worker that fails to
 * load never answers, so onfail lets the page stop waiting and say so.
 */
export function mdPdfWorker(onfail?: () => void) {
  if (!api) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'md-pdf' });
    if (onfail) worker.addEventListener('error', onfail);
    api = Comlink.wrap<MdPdfWorker>(worker);
  }
  return api;
}

export function stopMdPdfWorker() {
  api?.[Comlink.releaseProxy]();
  worker?.terminate();
  worker = undefined;
  api = undefined;
}

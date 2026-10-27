import * as Comlink from 'comlink';
import type { CsvWorker } from './worker';

export type { Output, ParseInfo } from './worker';

let worker: Worker | undefined;
let api: Comlink.Remote<CsvWorker> | undefined;

/** The CSV worker, started on first use */
export function csvWorker() {
  if (!api) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'csv' });
    api = Comlink.wrap<CsvWorker>(worker);
  }
  return api;
}

/** Stops the worker, e.g. to abandon a big parse in progress; the next call starts a fresh one */
export function stopCsvWorker() {
  worker?.terminate();
  worker = undefined;
  api = undefined;
}

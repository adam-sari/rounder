import * as Comlink from 'comlink';
import type { GifWorker } from './worker';

export type { GifWorker };

/** A GIF worker of the tool's own; `close()` when the tool goes away */
export function gifWorker() {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'gif-encoder' });
  return { api: Comlink.wrap<GifWorker>(worker), close: () => worker.terminate() };
}

/** hands bitmaps to the worker instead of copying them */
export const transfer = <T extends ImageBitmap | ImageBitmap[]>(value: T): T => Comlink.transfer(value, Array.isArray(value) ? value : [value]);

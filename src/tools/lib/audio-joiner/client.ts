import * as Comlink from 'comlink';
import type { JoinWorker } from './worker';

let worker: Worker | null = null;
let api: Comlink.Remote<JoinWorker> | null = null;

/** the mixing worker, started on first join */
export function joiner(): Comlink.Remote<JoinWorker> {
  if (!api) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'audio-joiner' });
    api = Comlink.wrap<JoinWorker>(worker);
  }
  return api;
}

/** sends a decoded track to the worker without copying it */
export const transferChannels = (channels: Float32Array[]) => Comlink.transfer(channels, [...new Set(channels.map((c) => c.buffer as ArrayBuffer))]);

export function disposeJoiner() {
  worker?.terminate();
  worker = null;
  api = null;
}

/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import type { Rnnoise } from '@shiguredo/rnnoise-wasm';
import { applyEnvelope, denoise, FRAME, frameStats, highpass, RATE, resampleSinc } from './dsp';

/*
 * RNNoise off the main thread, one piece of one channel per call (see planChunks). Audio
 * arrives and leaves as transferred buffers; cancelling terminates the worker (see client.ts),
 * since the frame loop can't yield.
 */

type Progress = ((p: number) => void) | undefined;

// the wasm is inlined in the module (~3 MB compressed), so it loads on first use, not with the page
let model: Promise<Rnnoise> | null = null;
function load() {
  model ??= import('@shiguredo/rnnoise-wasm')
    .then((m) => m.Rnnoise.load())
    .catch((e) => {
      model = null; // let the next job try the download again
      throw e;
    });
  return model;
}

export interface Piece {
  highpass: boolean;
  /** share of the cleaned signal; without it, dry and wet come back separately (the preview) */
  mix?: number;
  /** pre-roll to drop, then the samples to keep: `core` of them, plus the crossfade tail */
  skip: number;
  core: number;
  tail: number;
}

const api = {
  /** fetch and compile the model ahead of the first job */
  async ready() {
    await load();
  },

  toRate(x: Float32Array, rate: number, onProgress?: Progress) {
    const y = resampleSinc(x, rate, RATE, onProgress);
    return Comlink.transfer(y, [y.buffer]);
  },

  /** cleans a 48 kHz piece; returns the kept part, its voice probabilities and level stats */
  async clean(x: Float32Array, o: Piece, onProgress?: Progress) {
    const rn = await load();
    if (o.highpass) highpass(x, RATE);
    const wet = o.mix === undefined ? new Float32Array(x.length) : x;
    const state = rn.createDenoiseState();
    let vad: Float32Array;
    try {
      vad = denoise(x, wet, (f) => state.processFrame(f), o.mix ?? 1, onProgress);
    } finally {
      state.destroy();
    }
    const keep = (a: Float32Array) => a.slice(o.skip, o.skip + o.core + o.tail);
    const out = keep(wet);
    const dry = o.mix === undefined ? keep(x) : null;
    const frames = vad.slice(o.skip / FRAME, Math.ceil((o.skip + o.core) / FRAME));
    const stats = frameStats(out.subarray(0, o.core));
    const buffers = [out.buffer, frames.buffer, stats.energy.buffer, stats.peak.buffer];
    if (dry) buffers.push(dry.buffer);
    return Comlink.transfer({ out, dry, vad: frames, stats }, buffers);
  },

  finish(x: Float32Array, gains: Float32Array | null, gainDb: number) {
    applyEnvelope(x, gains, gainDb);
    return Comlink.transfer(x, [x.buffer]);
  },
};

export type CleanApi = typeof api;

Comlink.expose(api);

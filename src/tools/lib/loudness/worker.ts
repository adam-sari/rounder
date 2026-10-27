/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { applyGain } from '@/engines/media/dsp';
import type { Pcm } from '@/engines/media/types';
import { limit } from './limiter';
import { LoudnessMeter } from './lufs';

/*
 * Loudness DSP off the main thread. PCM arrives and leaves as transferred buffers, so an hour of
 * audio isn't copied on the way; cancelling terminates the worker (see process.ts).
 */

type Progress = ((p: number) => void) | undefined;

function measure(pcm: Pcm, onProgress: Progress) {
  const meter = new LoudnessMeter(pcm.sampleRate, pcm.channels.length);
  const n = pcm.channels[0]?.length ?? 0;
  const step = pcm.sampleRate * 10;
  for (let i = 0; i < n; i += step) {
    meter.push(pcm.channels.map((c) => c.subarray(i, i + step)));
    onProgress?.(Math.min(1, (i + step) / n));
  }
  return meter.result();
}

export interface ProcessOptions {
  gainDb: number;
  ceilingDb: number;
  /** run the true-peak limiter; otherwise the gain is applied as is */
  limit: boolean;
  /** measure the result too (for before/after reports) */
  measure: boolean;
}

const api = {
  measure: (pcm: Pcm, onProgress?: Progress) => measure(pcm, onProgress),

  process(pcm: Pcm, o: ProcessOptions, onProgress?: Progress) {
    const split = o.measure ? 0.7 : 1;
    let reductionDb = 0;
    if (o.limit) reductionDb = limit(pcm.channels, pcm.sampleRate, { gainDb: o.gainDb, ceilingDb: o.ceilingDb, onProgress: (p) => onProgress?.(p * split) });
    else applyGain(pcm.channels, o.gainDb);
    const after = o.measure ? measure(pcm, (p) => onProgress?.(split + (1 - split) * p)) : undefined;
    return Comlink.transfer({ pcm, reductionDb, after }, [...new Set(pcm.channels.map((c) => c.buffer as ArrayBuffer))]);
  },
};

export type DspApi = typeof api;

Comlink.expose(api);

/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { SongAnalyzer } from './analyzer';

/* One analysis per worker: the client starts a fresh one for each song and terminates it after. */

let durationSec = 0;
let job: SongAnalyzer | null = null;

const api = {
  start(duration: number) {
    durationSec = duration;
    job = null;
  },

  push(mono: Float32Array, sampleRate: number) {
    job ??= new SongAnalyzer(sampleRate, durationSec);
    job.push(mono);
  },

  finish() {
    const result = (job ?? new SongAnalyzer(44100, 0)).finish();
    job = null;
    const { min, max, rms } = result.peaks;
    const buffers = [min.buffer, max.buffer, rms.buffer, ...(result.tempo ? [result.tempo.beats.buffer] : [])];
    return Comlink.transfer(result, buffers);
  },
};

export type AnalysisWorker = typeof api;

Comlink.expose(api);

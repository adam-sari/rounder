import * as Comlink from 'comlink';
import { decodeAudio, MediaError, throwIfAborted, toMediaError, type Pcm, type StatusControl } from '@/engines/media';
import { finishPlan, joinFrames, mergeStats, mergeVad, planChunks, RATE, sameChannels, stitch, toStereo, type FrameStats, type Settings } from './dsp';
import type { CleanApi } from './worker';

/*
 * The browser side: decode with the media engine, resample to 48 kHz, cut each channel into
 * pieces and clean them on a small pool of RNNoise workers (the model runs at only ~5× real
 * time per core), stitch them back together, then gate and level with one plan for all channels.
 */

interface Slot {
  worker: Worker;
  api: Comlink.Remote<CleanApi>;
  /** rejecters of the calls in flight: a terminated worker never answers them */
  pending: Set<(e: unknown) => void>;
}

const slots: (Slot | undefined)[] = [];

const lanes = () => Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));

function slot(i: number): Slot {
  let s = slots[i];
  if (!s) {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'noise-reduction' });
    s = slots[i] = { worker, api: Comlink.wrap<CleanApi>(worker), pending: new Set() };
  }
  return s;
}

/** stops worker `i` and fails everything still waiting on it, so no other job hangs */
function kill(i: number, s: Slot) {
  s.worker.terminate();
  if (slots[i] === s) slots[i] = undefined;
  for (const reject of s.pending) reject(new MediaError('aborted', 'Cancelled.'));
  s.pending.clear();
}

/** runs a call on worker `i`; the RNNoise loop can't be interrupted, so aborting kills the worker */
function onWorker<T>(i: number, signal: AbortSignal | undefined, fn: (api: Comlink.Remote<CleanApi>) => Promise<T>): Promise<T> {
  throwIfAborted(signal);
  const s = slot(i);
  return new Promise<T>((resolve, reject) => {
    const abort = () => kill(i, s);
    s.pending.add(reject);
    signal?.addEventListener('abort', abort, { once: true });
    fn(s.api)
      .then(resolve, (e) => reject(toMediaError(e)))
      .finally(() => {
        s.pending.delete(reject);
        signal?.removeEventListener('abort', abort);
      });
  });
}

/** runs `count` tasks, each on whichever worker is free next */
async function pool<T>(count: number, run: (task: number, lane: number) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const lane = async (l: number) => {
    while (next < count) {
      const task = next++;
      results[task] = await run(task, l);
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes(), count) }, (_, l) => lane(l)));
  return results;
}

/** downloads and compiles the noise model while the user is still looking at their file */
export async function warmUp() {
  await onWorker(0, undefined, (api) => api.ready());
  // the other workers then find the model in the HTTP cache instead of downloading it again
  await Promise.all(Array.from({ length: lanes() - 1 }, (_, i) => onWorker(i + 1, undefined, (api) => api.ready())));
}

export function disposeWorkers() {
  slots.forEach((s, i) => s && kill(i, s));
  slots.length = 0;
}

const send = (x: Float32Array) => Comlink.transfer(x, [x.buffer]);

interface CleanOptions {
  highpass: boolean;
  /** see Piece.mix */
  mix?: number;
  /** shortest piece worth its second of pre-roll */
  minSec: number;
}

/**
 * 48 kHz cleaned channels (and the matching dry ones when `mix` is unset), voice probability and
 * stats. The cleaned audio is written over the 48 kHz input, so `channels` must be ours to spend.
 */
async function cleanChannels(channels: Float32Array[], rate: number, o: CleanOptions, signal?: AbortSignal, onProgress?: (p: number) => void) {
  const resampling = rate !== RATE;
  const resampleShare = resampling ? 0.1 : 0;
  const resampled = channels.map(() => 0);
  const toRate = (c: number) =>
    Comlink.proxy((p: number) => {
      resampled[c] = p;
      onProgress?.((resampleShare * resampled.reduce((a, b) => a + b, 0)) / channels.length);
    });
  const x48 = resampling ? await pool(channels.length, (c, l) => onWorker(l, signal, (api) => api.toRate(send(channels[c]), rate, toRate(c)))) : channels;

  const n = x48[0].length;
  const chunks = planChunks(n, Math.ceil(lanes() / x48.length), o.minSec);
  const tasks = x48.flatMap((_, c) => chunks.map((k) => ({ c, k })));
  const total = tasks.reduce((a, t) => a + t.k.end - t.k.start, 0);
  const done = tasks.map(() => 0);
  const report = () => onProgress?.(resampleShare + (1 - resampleShare) * (done.reduce((a, b) => a + b, 0) / total));

  const results = await pool(tasks.length, (t, l) => {
    const { c, k } = tasks[t];
    const piece = x48[c].slice(k.start, k.end);
    const size = k.end - k.start;
    const progress = Comlink.proxy((p: number) => {
      done[t] = p * size;
      report();
    });
    return onWorker(l, signal, (api) => api.clean(send(piece), { highpass: o.highpass, mix: o.mix, skip: k.from - k.start, core: k.to - k.from, tail: k.tail }, progress));
  });

  const perChannel = x48.map((_, c) => results.slice(c * chunks.length, (c + 1) * chunks.length));
  const frames32 = (n: number) => new Float32Array(n);
  return {
    out: perChannel.map((r, c) => stitch(n, chunks, r.map((p) => p.out), x48[c])),
    dry: o.mix === undefined ? perChannel.map((r) => stitch(n, chunks, r.map((p) => p.dry!))) : [],
    vad: mergeVad(perChannel.map((r) => joinFrames(r.map((p) => p.vad), frames32))),
    stats: mergeStats(
      perChannel.map((r): FrameStats => ({ energy: joinFrames(r.map((p) => p.stats.energy), (m) => new Float64Array(m)), peak: joinFrames(r.map((p) => p.stats.peak), frames32) })),
    ),
  };
}

/** indices of the channels that need cleaning: just the first when all of them are the same */
const uniqueChannels = (channels: Float32Array[]) => (channels.length > 1 && sameChannels(channels) ? [0] : channels.map((_, i) => i));

/** a duplicated mono channel goes back out as the same array on every channel */
const spread = (count: number, unique: number, cleaned: Float32Array[]) => Array.from({ length: count }, (_, c) => cleaned[unique === 1 ? 0 : c]);

export interface PreviewData {
  dry: Float32Array[];
  wet: Float32Array[];
  vad: Float32Array;
}

/** cleans a short section for the A/B player; `pcm` is copied, so it stays playable as the original */
export async function separate(pcm: Pcm, highpass: boolean, signal?: AbortSignal): Promise<PreviewData> {
  const which = uniqueChannels(pcm.channels);
  const r = await cleanChannels(
    which.map((c) => pcm.channels[c].slice()),
    pcm.sampleRate,
    { highpass, minSec: 4 },
    signal,
  );
  const count = pcm.channels.length;
  return { dry: spread(count, which.length, r.dry), wet: spread(count, which.length, r.out), vad: r.vad };
}

export interface Cleaned {
  pcm: Pcm;
  /** level change from the normalizer */
  gainDb: number;
  /** RNNoise heard speech somewhere (the gate stays off otherwise) */
  speech: boolean;
}

/**
 * Decodes `file`'s audio, cleans it and returns 48 kHz PCM. Progress: decoding is the first 10%,
 * the noise model nearly all the rest.
 */
export async function cleanAudio(file: Blob, s: Settings, ctl: StatusControl = {}): Promise<Cleaned> {
  const { signal } = ctl;
  const report = (from: number, to: number) => (p: number) => ctl.onProgress?.(from + (to - from) * p);
  ctl.onStatus?.('Reading the audio…');
  const pcm = await decodeAudio(file, {}, { signal, onStatus: ctl.onStatus, onProgress: report(0, 0.1) }).then((d) => ({ ...d, channels: toStereo(d.channels) }));
  if (!pcm.channels[0]?.length) throw new MediaError('no-tracks', 'This file has no sound to clean.');

  ctl.onStatus?.('Removing noise…');
  const which = uniqueChannels(pcm.channels);
  // the decoded buffers move into the workers, so `pcm` can't be used after this
  const r = await cleanChannels(
    which.map((c) => pcm.channels[c]),
    pcm.sampleRate,
    { highpass: s.highpass, mix: s.strength, minSec: 20 },
    signal,
    report(0.1, 0.97),
  );

  ctl.onStatus?.('Finishing…');
  const plan = finishPlan(r.stats, r.vad, s, which.length);
  let cleaned = r.out;
  if (plan.gains || plan.gainDb) {
    cleaned = await pool(cleaned.length, (c, l) => onWorker(l, signal, (api) => api.finish(send(cleaned[c]), plan.gains, plan.gainDb)));
  }
  ctl.onProgress?.(1);
  return { pcm: { sampleRate: RATE, channels: spread(pcm.channels.length, which.length, cleaned) }, gainDb: plan.gainDb, speech: plan.speech };
}

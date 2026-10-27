/// <reference lib="webworker" />
// Runs Demucs (htdemucs) off the page: load() with download progress, separate() per segment.
import { DemucsProcessor } from 'demucs-web';
import { toAiError } from '@/engines/ai/errors';
import { createOrtSession, type LoadOptions } from '@/engines/ai/load';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { exposeWorker, transfer } from '@/engines/ai/worker-utils';
import { computePeaks } from '@/engines/media/dsp';
import type { Peaks } from '@/engines/media/types';
import { PEAK_BUCKETS, STEM_IDS, type StemId } from './stems';

export type LoadChoice = Pick<LoadOptions, 'device' | 'variant'>;

let processor: DemucsProcessor | null = null;
let device: LoadOptions['device'];

async function open(o: LoadChoice, onProgress?: OnProgress) {
  // releasing a session on a lost GPU device can reject; it's being dropped either way
  void processor?.session?.release().catch(() => {});
  processor = null;
  // demucs-web's own default; its port was checked at this optimization level
  const r = await createOrtSession('demucs', { ...o, onProgress, sessionOptions: { graphOptimizationLevel: 'basic' } });
  processor = new DemucsProcessor({ ort: r.value.ort });
  processor.session = r.value.session;
  device = r.device;
  return { device: r.device, variant: r.variant };
}

const api = {
  load: (o: LoadChoice, onProgress: OnProgress) => open(o, throttleProgress(onProgress)),

  /**
   * 44.1 kHz stereo in (transferred), four stereo stems + waveform peaks out (transferred).
   * A fresh worker (after a cancel) reopens the model from the cache first.
   */
  async separate(left: Float32Array, right: Float32Array, o: LoadChoice, onSegment: (done: number) => void) {
    if (!processor) await open(o);
    const run = () => {
      processor!.onProgress = ({ currentSegment }) => onSegment(currentSegment);
      return processor!.separate(left, right);
    };
    let out;
    try {
      out = await run();
    } catch (err) {
      // a WebGPU failure mid-run (unsupported op, lost device, graphics memory full): start over on the CPU
      const code = toAiError(err).code;
      if (device !== 'webgpu' || (code !== 'failed' && code !== 'out-of-memory')) throw err;
      console.warn('Demucs: WebGPU failed while separating, retrying on the CPU', err);
      await open({ device: 'wasm' });
      out = await run();
    }
    const stems = {} as Record<StemId, Float32Array<ArrayBuffer>[]>;
    const peaks = {} as Record<StemId, Peaks>;
    for (const id of STEM_IDS) {
      stems[id] = [out[id].left, out[id].right];
      peaks[id] = computePeaks(stems[id], PEAK_BUCKETS);
    }
    const buffers = STEM_IDS.flatMap((id) => [...stems[id].map((c) => c.buffer), peaks[id].min.buffer, peaks[id].max.buffer, peaks[id].rms.buffer]);
    return transfer({ stems, peaks, device: device! }, buffers);
  },
};

exposeWorker(api);
export type DemucsWorker = typeof api;

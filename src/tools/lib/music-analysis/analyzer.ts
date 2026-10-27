import { PeakAccumulator } from '@/engines/media/dsp';
import type { Peaks } from '@/engines/media/types';
import { Decimator } from './fft';
import { ChromaAccumulator, detectKey, type Key } from './key';
import { estimateTempo, OnsetEnvelope, type Tempo } from './tempo';

/** waveform resolution: one bucket per 25 ms, enough to zoom into a few beats */
const BUCKETS_PER_SEC = 40;

export interface Analysis {
  durationSec: number;
  tempo: Tempo | null;
  key: Key | null;
  peaks: Peaks;
}

/**
 * Streaming song analysis: push mono chunks at the source rate in order, then finish(). Only the
 * onset envelope, a pitch histogram and waveform peaks are kept, so hour-long mixes fit in memory.
 */
export class SongAnalyzer {
  private readonly decimator: Decimator;
  private readonly onsets: OnsetEnvelope;
  private readonly chroma: ChromaAccumulator;
  private readonly peaks: PeakAccumulator;
  private frames = 0;

  constructor(
    readonly sampleRate: number,
    durationSec: number,
  ) {
    this.decimator = new Decimator(sampleRate);
    this.onsets = new OnsetEnvelope(this.decimator.rate);
    this.chroma = new ChromaAccumulator(this.decimator.rate);
    const buckets = Math.min(200_000, Math.max(1000, Math.round(durationSec * BUCKETS_PER_SEC)));
    this.peaks = new PeakAccumulator(Math.max(1, Math.ceil(durationSec * sampleRate)), buckets);
  }

  push(mono: Float32Array) {
    this.frames += mono.length;
    this.peaks.push([mono]);
    const low = this.decimator.push(mono);
    this.onsets.push(low);
    this.chroma.push(low);
  }

  finish(): Analysis {
    const { chroma, tuningCents } = this.chroma.result();
    return {
      durationSec: this.frames / this.sampleRate,
      tempo: estimateTempo(this.onsets.values32(), this.onsets.fps, (i) => this.onsets.time(i)),
      key: detectKey(chroma, tuningCents),
      peaks: this.peaks.result(),
    };
  }
}

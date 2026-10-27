import { formatBytes } from '@/engines/media/math';
import { SincResampler } from './resampler';
import { PhaseVocoder } from './vocoder';

/*
 * Tempo and pitch, independently. A pitch shift is a time stretch by the pitch ratio followed by
 * resampling by the same ratio: the length comes back to where it was and every frequency moves.
 * Changing both by the same factor ("like a record") skips the vocoder and only resamples.
 */

export interface StretchSettings {
  /** playback speed: 2 = twice as fast, half as long */
  tempo: number;
  /** frequency ratio: 2 = an octave up */
  pitch: number;
  /** analysis frame length (power of two); see frameSize */
  fftSize: number;
}

export type SoundKind = 'music' | 'voice';

export const semitonesToRatio = (semitones: number, cents = 0) => 2 ** ((semitones + cents / 100) / 12);

/**
 * ~93 ms frames resolve the low notes in music; ~46 ms keeps speech consonants tighter.
 * 4096 / 2048 samples at 44.1 and 48 kHz.
 */
export function frameSize(sampleRate: number, kind: SoundKind): number {
  const seconds = kind === 'music' ? 0.09 : 0.045;
  return 2 ** Math.max(8, Math.min(15, Math.round(Math.log2(sampleRate * seconds))));
}

const near1 = (x: number) => Math.abs(x - 1) < 1e-6;

/** what the pipeline does: stretch by `stretch`, then resample by `step` */
export function plan(s: Pick<StretchSettings, 'tempo' | 'pitch'>) {
  const stretch = s.pitch / s.tempo;
  return { stretch: near1(stretch) ? 1 : stretch, step: near1(s.pitch) ? 1 : s.pitch };
}

/** output frames for an input of `frames`, give or take one */
export const outputFrames = (frames: number, tempo: number) => Math.round(frames / tempo);

/** chains the vocoder and the resampler; one or two channels */
export class Stretcher {
  private readonly vocoder: PhaseVocoder | null;
  private readonly resampler: SincResampler | null;

  constructor(settings: StretchSettings, channels: 1 | 2) {
    const { stretch, step } = plan(settings);
    this.vocoder = stretch === 1 ? null : new PhaseVocoder(stretch, channels, settings.fftSize);
    this.resampler = step === 1 ? null : new SincResampler(step, channels);
  }

  /** exact output frames for `frames` of input, push() and flush() together */
  length(frames: number) {
    const v = this.vocoder ? Math.round(frames * this.vocoder.stretch) : frames;
    return this.resampler ? Math.round(v / this.resampler.step) : v;
  }

  push(planes: Float32Array[]): Float32Array[] {
    const v = this.vocoder ? this.vocoder.push(planes) : planes;
    return this.resampler ? this.resampler.push(v) : v;
  }

  flush(): Float32Array[] {
    if (!this.vocoder && !this.resampler) return [];
    if (!this.vocoder) return this.resampler!.flush();
    const tail = this.vocoder.flush();
    if (!this.resampler) return tail;
    return concat([this.resampler.push(tail), this.resampler.flush()]);
  }
}

/** whole-buffer convenience: processes in chunks and reports progress (0–1) */
export function stretchChannels(channels: Float32Array[], settings: StretchSettings, onProgress?: (p: number) => void): Float32Array[] {
  const count = Math.min(2, channels.length) as 1 | 2;
  const input = channels.slice(0, count);
  const frames = input[0]?.length ?? 0;
  const st = new Stretcher(settings, count);
  // written in place rather than collected and joined, so a long file needs one output copy, not two
  const out = Array.from({ length: count }, () => new Float32Array(st.length(frames)));
  let written = 0;
  const put = (part: Float32Array[]) => {
    out.forEach((o, c) => part[c] && o.set(part[c], written));
    written += part[0]?.length ?? 0;
  };
  const CHUNK = 1 << 15;
  for (let at = 0; at < frames; at += CHUNK) {
    put(st.push(input.map((ch) => ch.subarray(at, Math.min(frames, at + CHUNK)))));
    onProgress?.(Math.min(frames, at + CHUNK) / frames);
  }
  put(st.flush());
  return out;
}

/**
 * Rough peak memory for a whole-file job: the decoded input, the stretched float output and
 * its 16-bit WAV (at most stereo, since surround is folded down first).
 */
function memoryBytes(durationSec: number, sampleRate: number, channels: number, tempo: number): number {
  const ch = Math.min(2, Math.max(1, channels));
  const inFrames = durationSec * sampleRate;
  return inFrames * ch * 4 + (inFrames / tempo) * ch * (4 + 2);
}

/** a heads-up when a file is long enough to strain memory, '' otherwise */
export function memoryNote(durationSec: number, sampleRate: number, channels: number, tempo: number): string {
  const bytes = memoryBytes(durationSec, sampleRate, channels, tempo);
  return bytes > 1.5e9 ? `long file: needs about ${formatBytes(bytes)} of memory, may fail on phones` : '';
}

function concat(parts: Float32Array[][]): Float32Array[] {
  const chs = Math.max(0, ...parts.map((p) => p.length));
  return Array.from({ length: chs }, (_, c) => {
    const out = new Float32Array(parts.reduce((n, p) => n + (p[c]?.length ?? 0), 0));
    let at = 0;
    for (const p of parts) {
      if (!p[c]) continue;
      out.set(p[c], at);
      at += p[c].length;
    }
    return out;
  });
}

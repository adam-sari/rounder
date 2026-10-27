import { dbToGain } from '@/engines/media/dsp';

/*
 * Pure DSP around RNNoise: band-limited resampling to 48 kHz, an 80 Hz high-pass, the frame
 * loop with dry/wet mixing, a voice gate driven by RNNoise's speech probability and a gentle
 * normalizer. No DOM or wasm here, so the worker, the preview and the unit tests share it.
 */

/** RNNoise only runs at 48 kHz, on 480-sample (10 ms) frames */
export const RATE = 48_000;
export const FRAME = 480;
/** its output trails the input by two frames (measured on this build), so dry and wet are re-aligned */
export const DELAY_FRAMES = 2;
/** RNNoise expects 16-bit sample values, not -1…1 floats */
const SCALE = 32768;
/** length of the A/B preview section */
export const PREVIEW_SEC = 15;

export interface Settings {
  /** 0–1 share of the cleaned signal; the rest is the original */
  strength: number;
  highpass: boolean;
  gate: boolean;
  normalize: boolean;
}

export const DEFAULT_SETTINGS: Settings = { strength: 0.9, highpass: true, gate: false, normalize: false };

/** one RNNoise call: cleans a 480-sample frame (16-bit scale) in place, returns the voice probability 0–1 */
export type Denoiser = (frame: Float32Array) => number;

type Progress = ((p: number) => void) | undefined;

/** 2nd-order Butterworth high-pass (12 dB/octave), in place */
export function highpass(x: Float32Array, rate: number, hz = 80) {
  const w = (2 * Math.PI * hz) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / Math.SQRT2;
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/**
 * Windowed-sinc resampling. The engine's linear resampler is fine for previews, but this audio
 * is what people download, and linear interpolation leaves audible aliasing in the highs.
 */
export function resampleSinc(x: Float32Array, from: number, to: number, onProgress?: Progress): Float32Array {
  if (from === to) return x;
  const ratio = to / from;
  const cutoff = Math.min(1, ratio) * 0.95;
  const half = Math.ceil(16 / cutoff);
  const PHASES = 256;
  const table = new Float32Array(half * PHASES + 2);
  for (let j = 0; j < table.length; j++) {
    const t = j / PHASES;
    const u = Math.min(1, t / half);
    const blackman = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
    const s = t === 0 ? 1 : Math.sin(Math.PI * cutoff * t) / (Math.PI * cutoff * t);
    table[j] = cutoff * s * blackman;
  }
  const n = Math.floor(x.length * ratio);
  const out = new Float32Array(n);
  const tick = Math.max(1, Math.floor(n / 50));
  for (let i = 0; i < n; i++) {
    const pos = i / ratio;
    const c = Math.floor(pos);
    const lo = Math.max(0, c - half + 1);
    const hi = Math.min(x.length - 1, c + half);
    let acc = 0;
    for (let k = lo; k <= hi; k++) {
      const d = Math.abs(pos - k) * PHASES;
      const j = d | 0;
      acc += x[k] * (table[j] + (table[j + 1] - table[j]) * (d - j));
    }
    out[i] = acc;
    if (i % tick === 0) onProgress?.(i / n);
  }
  return out;
}

/**
 * Runs `x` (48 kHz, -1…1) through the denoiser and writes the cleaned signal, aligned with the
 * input, to `out`, blended with the dry input by `mix`. `out` may be `x` itself: every write
 * lands two frames behind the frame being read. Returns the voice probability per output frame.
 */
export function denoise(x: Float32Array, out: Float32Array, denoiser: Denoiser, mix = 1, onProgress?: Progress): Float32Array {
  const n = x.length;
  const frames = Math.ceil(n / FRAME);
  const vad = new Float32Array(frames);
  const buf = new Float32Array(FRAME);
  const total = frames + DELAY_FRAMES;
  for (let k = 0; k < total; k++) {
    const at = k * FRAME;
    buf.fill(0);
    for (let i = 0; i < FRAME && at + i < n; i++) buf[i] = x[at + i] * SCALE;
    const p = denoiser(buf);
    if (k >= DELAY_FRAMES) {
      const f = k - DELAY_FRAMES;
      const o = f * FRAME;
      vad[f] = p;
      for (let i = 0; i < FRAME && o + i < n; i++) out[o + i] = mix * (buf[i] / SCALE) + (1 - mix) * x[o + i];
    }
    if (k % 100 === 0) onProgress?.(k / total);
  }
  onProgress?.(1);
  return vad;
}

/**
 * One piece of a channel for a parallel worker. The worker reads [start, end): a second of
 * pre-roll so RNNoise's memory has settled by `from`, and enough past `to` for its lookahead and
 * the crossfade into the next piece. It keeps [from, to + tail).
 */
export interface Chunk {
  from: number;
  to: number;
  start: number;
  end: number;
  /** samples kept past `to` for the crossfade (0 on the last piece) */
  tail: number;
}

/** crossfade between neighbouring pieces, so no click marks the seam */
export const OVERLAP = FRAME;
const PRE_ROLL = RATE;

/** frame-aligned pieces of at least `minSec`, at most `pieces` of them */
export function planChunks(n: number, pieces: number, minSec = 20): Chunk[] {
  const count = Math.max(1, Math.min(pieces, Math.floor(n / (minSec * RATE))));
  const size = Math.ceil(n / count / FRAME) * FRAME;
  const chunks: Chunk[] = [];
  for (let from = 0; from < n; from += size) {
    const to = Math.min(n, from + size);
    const tail = to < n ? OVERLAP : 0;
    chunks.push({ from, to, start: Math.max(0, from - PRE_ROLL), end: Math.min(n, to + tail + DELAY_FRAMES * FRAME + FRAME), tail });
  }
  return chunks;
}

/**
 * Joins pieces cleaned separately (each `to - from + tail` long), crossfading every seam. `out`
 * may be the channel the pieces were cut from, which saves a whole-file copy on long recordings.
 */
export function stitch(n: number, chunks: Chunk[], parts: Float32Array[], out: Float32Array = new Float32Array(n)): Float32Array {
  chunks.forEach((c, i) => {
    const part = parts[i];
    out.set(part.subarray(0, c.to - c.from), c.from);
    const prev = chunks[i - 1];
    if (!prev) return;
    const tail = parts[i - 1].subarray(prev.to - prev.from);
    for (let j = 0; j < tail.length; j++) {
      const w = (j + 0.5) / tail.length;
      out[c.from + j] = tail[j] * (1 - w) + part[j] * w;
    }
  });
  return out;
}

/**
 * Surround → stereo, mixed the way Web Audio and mediabunny do it for 5.1 (L R C LFE SL SR), and
 * turned down only if the sum would clip. RNNoise then runs on two channels instead of six, and
 * every output format (MP3, AAC, a video's soundtrack) ends up stereo anyway.
 */
export function toStereo(channels: Float32Array[]): Float32Array[] {
  if (channels.length <= 2) return channels;
  const n = channels[0].length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  if (channels.length === 6) {
    const [L, R, C, , SL, SR] = channels;
    for (let i = 0; i < n; i++) {
      l[i] = L[i] + Math.SQRT1_2 * (C[i] + SL[i]);
      r[i] = R[i] + Math.SQRT1_2 * (C[i] + SR[i]);
    }
  } else {
    // other layouts: alternate channels left and right
    channels.forEach((ch, c) => {
      const out = c % 2 ? r : l;
      for (let i = 0; i < n; i++) out[i] += ch[i];
    });
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
  if (peak > 1) {
    for (let i = 0; i < n; i++) {
      l[i] /= peak;
      r[i] /= peak;
    }
  }
  return [l, r];
}

/** true when every channel carries the same signal (mono saved as stereo): clean it once */
export function sameChannels(channels: Float32Array[], tolerance = 1e-4): boolean {
  const [first, ...rest] = channels;
  return rest.every((ch) => {
    if (ch.length !== first.length) return false;
    for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i] - first[i]) > tolerance) return false;
    return true;
  });
}

/** per-frame voice probability across channels (the loudest voice wins) */
export function mergeVad(vads: Float32Array[]): Float32Array {
  const out = Float32Array.from(vads[0]);
  for (const v of vads.slice(1)) for (let k = 0; k < out.length; k++) out[k] = Math.max(out[k], v[k] ?? 0);
  return out;
}

export interface FrameStats {
  /** sum of squares per frame, summed over channels */
  energy: Float64Array;
  /** largest absolute sample per frame, over all channels */
  peak: Float32Array;
}

export function frameStats(x: Float32Array): FrameStats {
  const frames = Math.ceil(x.length / FRAME);
  const energy = new Float64Array(frames);
  const peak = new Float32Array(frames);
  for (let k = 0; k < frames; k++) {
    let e = 0;
    let p = 0;
    for (let i = k * FRAME, end = Math.min(x.length, i + FRAME); i < end; i++) {
      e += x[i] * x[i];
      p = Math.max(p, Math.abs(x[i]));
    }
    energy[k] = e;
    peak[k] = p;
  }
  return { energy, peak };
}

export function mergeStats(all: FrameStats[]): FrameStats {
  const energy = Float64Array.from(all[0].energy);
  const peak = Float32Array.from(all[0].peak);
  for (const s of all.slice(1)) {
    for (let k = 0; k < energy.length; k++) {
      energy[k] += s.energy[k] ?? 0;
      peak[k] = Math.max(peak[k], s.peak[k] ?? 0);
    }
  }
  return { energy, peak };
}

export const GATE = {
  /** RNNoise voice probability that counts as speech */
  threshold: 0.5,
  /** stays open this long after speech (300 ms), so word endings and short pauses survive */
  holdFrames: 30,
  /** opens this far ahead of speech (60 ms), so first syllables aren't clipped */
  lookaheadFrames: 6,
  /** how far the gaps are turned down */
  depthDb: 20,
  /** ramp lengths, in frames */
  attackFrames: 4,
  releaseFrames: 15,
};

export const hasSpeech = (vad: Float32Array, threshold = GATE.threshold) => vad.some((p) => p >= threshold);

/**
 * Per-frame gain (linear) that ducks everything but speech. Offline, so it can look ahead:
 * it opens before the speech starts and closes slowly after it ends.
 */
export function gateEnvelope(vad: Float32Array, o = GATE): Float32Array {
  const n = vad.length;
  const db = new Float32Array(n).fill(-o.depthDb);
  let openUntil = -1;
  // a backwards sweep finds, for each frame, whether speech starts within the lookahead
  let nextSpeech = Infinity;
  const ahead = new Int32Array(n);
  for (let k = n - 1; k >= 0; k--) {
    if (vad[k] >= o.threshold) nextSpeech = k;
    ahead[k] = nextSpeech - k <= o.lookaheadFrames ? 1 : 0;
  }
  for (let k = 0; k < n; k++) {
    if (vad[k] >= o.threshold) openUntil = k + o.holdFrames;
    if (k <= openUntil || ahead[k]) db[k] = 0;
  }
  const release = o.depthDb / o.releaseFrames;
  const attack = o.depthDb / o.attackFrames;
  for (let k = 1; k < n; k++) db[k] = Math.max(db[k], db[k - 1] - release);
  for (let k = n - 2; k >= 0; k--) db[k] = Math.max(db[k], db[k + 1] - attack);
  return db.map(dbToGain);
}

export const NORMALIZE = {
  /** speech RMS to aim for, in dBFS (a comfortable spoken-word level) */
  targetDb: -20,
  /** no sample may end up above this */
  ceilingDb: -1,
  maxBoostDb: 18,
};

/**
 * dB to add so speech sits near the target level without any peak passing the ceiling (no
 * limiter, hence "gentle"). Speech frames are measured when there's at least a second of
 * them, otherwise everything is.
 */
export function normalizeGainDb(stats: FrameStats, vad: Float32Array, gains: Float32Array | null, channels: number, o = NORMALIZE): number {
  let speech = 0;
  let speechFrames = 0;
  let all = 0;
  let peak = 0;
  const frames = stats.energy.length;
  for (let k = 0; k < frames; k++) {
    const g = gains ? gains[k] : 1;
    const e = stats.energy[k] * g * g;
    all += e;
    if (vad[k] >= GATE.threshold) {
      speech += e;
      speechFrames++;
    }
    const gMax = gains ? Math.max(g, gains[k + 1] ?? g) : 1;
    peak = Math.max(peak, stats.peak[k] * gMax);
  }
  const useSpeech = speechFrames >= 100;
  const meanSq = (useSpeech ? speech / speechFrames : all / Math.max(1, frames)) / (FRAME * channels);
  if (!(meanSq > 0) || !(peak > 0)) return 0;
  const rmsDb = 10 * Math.log10(meanSq);
  return Math.min(o.targetDb - rmsDb, o.ceilingDb - 20 * Math.log10(peak), o.maxBoostDb);
}

/** the gate envelope and level change for a cleaned signal; null gains = gate off or no speech */
export function finishPlan(stats: FrameStats, vad: Float32Array, s: Pick<Settings, 'gate' | 'normalize'>, channels: number) {
  const speech = hasSpeech(vad);
  const gains = s.gate && speech ? gateEnvelope(vad) : null;
  const gainDb = s.normalize ? normalizeGainDb(stats, vad, gains, channels) : 0;
  return { gains, gainDb, speech };
}

/** applies the per-frame envelope (interpolated per sample) and a fixed gain, in place */
export function applyEnvelope(x: Float32Array, gains: Float32Array | null, gainDb: number) {
  const fixed = dbToGain(gainDb);
  if (!gains) {
    if (gainDb) for (let i = 0; i < x.length; i++) x[i] *= fixed;
    return;
  }
  for (let k = 0; k < gains.length; k++) {
    const a = gains[k] * fixed;
    const b = (gains[k + 1] ?? gains[k]) * fixed;
    const at = k * FRAME;
    for (let i = 0; i < FRAME && at + i < x.length; i++) x[at + i] *= a + ((b - a) * i) / FRAME;
  }
}

/** concatenates per-piece frame data (voice probability, stats) in order */
export function joinFrames<T extends Float32Array | Float64Array>(parts: T[], make: (n: number) => T): T {
  const out = make(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** the preview: blends cached dry/wet channels with the current settings, like the export does */
export function renderPreview(dry: Float32Array[], wet: Float32Array[], vad: Float32Array, s: Settings) {
  const channels = dry.map((d, c) => {
    const w = wet[c];
    const out = new Float32Array(d.length);
    for (let i = 0; i < out.length; i++) out[i] = s.strength * w[i] + (1 - s.strength) * d[i];
    return out;
  });
  const plan = finishPlan(mergeStats(channels.map(frameStats)), vad, s, channels.length);
  for (const ch of channels) applyEnvelope(ch, plan.gains, plan.gainDb);
  return { channels, ...plan };
}

/** start (s) of the `windowSec` stretch with the most going on, from waveform RMS buckets */
export function busiestWindow(rms: Float32Array, duration: number, windowSec = PREVIEW_SEC): number {
  if (duration <= windowSec || !rms.length) return 0;
  const w = Math.max(1, Math.round((windowSec / duration) * rms.length));
  let sum = 0;
  for (let i = 0; i < w; i++) sum += rms[i];
  let best = sum;
  let at = 0;
  for (let i = w; i < rms.length; i++) {
    sum += rms[i] - rms[i - w];
    if (sum > best) {
      best = sum;
      at = i - w + 1;
    }
  }
  return clampSection((at / rms.length) * duration, duration, windowSec);
}

export const clampSection = (start: number, duration: number, windowSec = PREVIEW_SEC) => Math.max(0, Math.min(start, duration - windowSec));

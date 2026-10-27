import type { Peaks, Pcm } from './types';

/*
 * Pure audio helpers: no DOM, no WebCodecs, so they run in workers and unit tests alike.
 */

export const dbToGain = (db: number) => 10 ** (db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-9));

export const pcmFrames = (pcm: Pcm) => pcm.channels[0]?.length ?? 0;
export const pcmDuration = (pcm: Pcm) => pcmFrames(pcm) / pcm.sampleRate;

export function mixdown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0]?.length ?? 0);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i];
  const k = 1 / channels.length;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

export function applyGain(channels: Float32Array[], db: number) {
  const g = dbToGain(db);
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

/** largest absolute sample, for normalising */
export function peakLevel(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return peak;
}

/**
 * Streaming linear-interpolation resampler. `step` is how far the read position moves per
 * output frame: inRate / outRate for sample-rate conversion, or the speed factor for
 * tape-style speed changes (pitch follows speed). Keeps state between chunks so there are
 * no clicks at chunk boundaries.
 */
export class Resampler {
  private pos = 0;
  private prev: Float32Array;
  constructor(
    readonly step: number,
    channels: number,
  ) {
    this.prev = new Float32Array(channels);
  }

  process(chunk: Float32Array[]): Float32Array[] {
    const n = chunk[0]?.length ?? 0;
    if (n === 0) return chunk.map(() => new Float32Array(0));
    // read position runs over a virtual array where index -1 is the last frame of the previous chunk
    const count = Math.max(0, Math.ceil((n - 1 - this.pos) / this.step));
    const out = chunk.map(() => new Float32Array(count));
    let pos = this.pos;
    for (let k = 0; k < count; k++, pos += this.step) {
      const i = Math.floor(pos);
      const frac = pos - i;
      for (let c = 0; c < chunk.length; c++) {
        const a = i < 0 ? this.prev[c] : chunk[c][i];
        const b = chunk[c][i + 1];
        out[c][k] = a + (b - a) * frac;
      }
    }
    this.pos = pos - n;
    for (let c = 0; c < chunk.length; c++) this.prev[c] = chunk[c][n - 1];
    return out;
  }
}

export function resample(pcm: Pcm, sampleRate: number): Pcm {
  if (sampleRate === pcm.sampleRate) return pcm;
  const r = new Resampler(pcm.sampleRate / sampleRate, pcm.channels.length);
  return { sampleRate, channels: r.process(pcm.channels) };
}

/**
 * Builds waveform peaks incrementally, so long files never need to sit in memory whole.
 * `totalFrames` fixes the bucket width up front; frames past the estimate land in the last bucket.
 */
export class PeakAccumulator {
  private min: Float32Array;
  private max: Float32Array;
  private sumSq: Float64Array;
  private counts: Uint32Array;
  private frame = 0;
  private readonly perBucket: number;

  constructor(
    totalFrames: number,
    readonly buckets: number,
  ) {
    this.perBucket = Math.max(1, totalFrames / buckets);
    this.min = new Float32Array(buckets);
    this.max = new Float32Array(buckets);
    this.sumSq = new Float64Array(buckets);
    this.counts = new Uint32Array(buckets);
  }

  push(channels: Float32Array[]) {
    const n = channels[0]?.length ?? 0;
    const chs = channels.length;
    for (let i = 0; i < n; i++) {
      let lo = 0;
      let hi = 0;
      let sq = 0;
      for (let c = 0; c < chs; c++) {
        const v = channels[c][i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        sq += v * v;
      }
      const b = Math.min(this.buckets - 1, Math.floor(this.frame++ / this.perBucket));
      if (lo < this.min[b]) this.min[b] = lo;
      if (hi > this.max[b]) this.max[b] = hi;
      this.sumSq[b] += sq / chs;
      this.counts[b]++;
    }
  }

  result(): Peaks {
    const rms = new Float32Array(this.buckets);
    for (let b = 0; b < this.buckets; b++) rms[b] = this.counts[b] ? Math.sqrt(this.sumSq[b] / this.counts[b]) : 0;
    return { min: this.min, max: this.max, rms };
  }
}

export function computePeaks(pcm: Pcm | Float32Array[], buckets: number): Peaks {
  const channels = Array.isArray(pcm) ? pcm : pcm.channels;
  const acc = new PeakAccumulator(channels[0]?.length ?? 0, Math.max(1, Math.floor(buckets)));
  acc.push(channels);
  return acc.result();
}

/** sample formats a WAV can carry */
export type WavFormat = 'pcm-s16' | 'pcm-s24' | 'pcm-f32';

/** Writes a canonical RIFF/WAVE file (WAVE_FORMAT_PCM or IEEE float). */
export function writeWav(pcm: Pcm, format: WavFormat = 'pcm-s16'): ArrayBuffer {
  const chs = pcm.channels.length;
  const frames = pcmFrames(pcm);
  const bytesPer = format === 'pcm-s16' ? 2 : format === 'pcm-s24' ? 3 : 4;
  const dataBytes = frames * chs * bytesPer;
  const buf = new ArrayBuffer(44 + dataBytes + (dataBytes & 1));
  const v = new DataView(buf);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, buf.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, format === 'pcm-f32' ? 3 : 1, true);
  v.setUint16(22, chs, true);
  v.setUint32(24, pcm.sampleRate, true);
  v.setUint32(28, pcm.sampleRate * chs * bytesPer, true);
  v.setUint16(32, chs * bytesPer, true);
  v.setUint16(34, bytesPer * 8, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < chs; c++) {
      const s = Math.max(-1, Math.min(1, pcm.channels[c][i]));
      if (format === 'pcm-f32') v.setFloat32(o, pcm.channels[c][i], true);
      else if (format === 'pcm-s16') v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      else {
        const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        v.setUint8(o, x & 0xff);
        v.setUint8(o + 1, (x >> 8) & 0xff);
        v.setUint8(o + 2, (x >> 16) & 0xff);
      }
      o += bytesPer;
    }
  }
  return buf;
}

/** Reads 8/16/24/32-bit integer and 32/64-bit float WAVs (including WAVE_FORMAT_EXTENSIBLE). */
export function parseWav(buffer: ArrayBuffer): Pcm {
  const v = new DataView(buffer);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' && tag(0) !== 'RF64') throw new Error('Not a WAV file');
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let o = 12;
  while (o + 8 <= buffer.byteLength) {
    const id = tag(o);
    let size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = v.getUint16(body, true);
      if (format === 0xfffe) format = v.getUint16(body + 24, true); // extensible: sub-format GUID starts with the tag
      fmt = { format, channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt chunk');
      if (size === 0xffffffff || body + size > buffer.byteLength) size = buffer.byteLength - body; // RF64 / streamed
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      const float = fmt.format === 3;
      let p = body;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++, p += bytes) {
          let s: number;
          if (float) s = bytes === 8 ? v.getFloat64(p, true) : v.getFloat32(p, true);
          else if (bytes === 1) s = (v.getUint8(p) - 128) / 128;
          else if (bytes === 2) s = v.getInt16(p, true) / 0x8000;
          else if (bytes === 3) s = ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 0x800000);
          else s = v.getInt32(p, true) / 0x80000000;
          channels[c][i] = s;
        }
      }
      return { sampleRate: fmt.sampleRate, channels };
    }
    o = body + size + (size & 1);
  }
  throw new Error('WAV file has no audio data');
}

/** sample rates each lossy encoder reliably accepts; anything else gets resampled */
export function encoderSampleRate(codec: string, rate: number): number {
  const allowed: Record<string, number[]> = {
    opus: [8000, 12000, 16000, 24000, 48000],
    aac: [44100, 48000],
    mp3: [32000, 44100, 48000, 22050, 24000, 16000],
    vorbis: [44100, 48000],
  };
  const list = allowed[codec];
  if (!list || list.includes(rate)) return rate;
  return codec === 'opus' ? 48000 : rate <= 44100 ? 44100 : 48000;
}

/** linear fade in/out over the first/last `sec` seconds, in place */
export function fade(channels: Float32Array[], sampleRate: number, { inSec = 0, outSec = 0 }) {
  const n = channels[0]?.length ?? 0;
  const fi = Math.min(n, Math.round(inSec * sampleRate));
  const fo = Math.min(n, Math.round(outSec * sampleRate));
  for (const ch of channels) {
    for (let i = 0; i < fi; i++) ch[i] *= i / fi;
    for (let i = 0; i < fo; i++) ch[n - 1 - i] *= i / fo;
  }
}

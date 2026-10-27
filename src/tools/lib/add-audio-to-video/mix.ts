import { Resampler } from '@/engines/media/dsp';
import { MediaError, throwIfAborted, type Pcm, type Segment } from '@/engines/media/types';

/*
 * Where the music sits on the video's timeline, and the PCM mix that bakes it in.
 * All times are video seconds unless named otherwise; the music "segment" is the trimmed
 * part of the music file, which repeats when `loop` is on.
 */

export interface MixPlan {
  /** video length; the soundtrack is exactly this long */
  duration: number;
  /** video time the music starts at */
  offset: number;
  /** length of the trimmed music segment */
  musicLength: number;
  loop: boolean;
  fadeIn: number;
  fadeOut: number;
  /** linear gains, 1 = as is */
  musicGain: number;
  originalGain: number;
}

const EPS = 1e-3;
const MAX_BLOCKS = 200;

/** video time where the music stops being heard */
export const musicEnd = (p: MixPlan) => (p.musicLength <= 0 ? p.offset : p.loop ? p.duration : Math.min(p.duration, p.offset + p.musicLength));

/** each play-through of the music, in video time (for drawing the lane) */
export function musicBlocks(p: MixPlan): Segment[] {
  const end = musicEnd(p);
  const out: Segment[] = [];
  for (let s = p.offset; s < end - EPS; s += p.musicLength) {
    // a tiny loop over a long video would be thousands of slivers; the rest draws as one
    if (out.length === MAX_BLOCKS - 1) {
      out.push({ start: s, end });
      break;
    }
    out.push({ start: s, end: Math.min(end, s + p.musicLength) });
  }
  return out;
}

/** seconds into the music segment that play at video time `t`, or null while it's silent */
export function musicTimeAt(p: MixPlan, t: number): number | null {
  if (t < p.offset || t >= musicEnd(p)) return null;
  const rel = t - p.offset;
  return p.loop ? rel % p.musicLength : rel;
}

/** fade envelope 0–1 at video time `t` (0 where the music isn't playing) */
export function musicEnvelope(p: MixPlan, t: number): number {
  const end = musicEnd(p);
  if (t < p.offset || t >= end) return 0;
  let g = 1;
  if (p.fadeIn > 0) g = Math.min(g, (t - p.offset) / p.fadeIn);
  if (p.fadeOut > 0) g = Math.min(g, (end - t) / p.fadeOut);
  return Math.max(0, Math.min(1, g));
}

/**
 * True when the engine can swap the soundtrack straight from the music file (no decoding or
 * mixing): nothing of the original is kept, the music starts at 0 with no fades, and the
 * trimmed segment either covers the video or runs to the end of the file anyway.
 */
export function canReplaceDirectly(p: MixPlan, trim: Segment, sourceLength: number, hasOriginal: boolean): boolean {
  if ((hasOriginal && p.originalGain > 0) || p.offset > EPS || p.fadeIn > 0 || p.fadeOut > 0 || !(p.musicGain > 0)) return false;
  const covers = trim.end - trim.start >= p.duration - EPS;
  return covers || (!p.loop && trim.end >= sourceLength - EPS);
}

/** 44-byte header for 16-bit PCM WAV */
export function wavHeader(frames: number, sampleRate: number, channels: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44);
  const v = new DataView(bytes.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  const data = frames * channels * 2;
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, data, true);
  return bytes;
}

// ---------------------------------------------------------------- reading audio a window at a time

/** decodes [start, end) seconds of a source, e.g. the engine's decodeAudio with start/end */
export type ReadPcm = (start: number, end: number) => Promise<Pcm>;
type Stereo = Float32Array[];

/** seconds decoded per read, so long videos never sit in memory whole */
const WINDOW = 60;
/** each read starts this early and drops it, so AAC/MP3/Opus decoders have history at the seam */
const PREROLL = 0.2;

function join(a: Float32Array, b: Float32Array): Float32Array {
  if (!a.length) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** WAVE channel order (FL FR FC LFE BL BR SL SR): 5.1 / 7.1 fold down with center and surrounds at −3 dB, LFE dropped */
function stereoTaps(n: number): [number, number][][] {
  const k = Math.SQRT1_2;
  if (n === 6) return [[[0, 1], [2, k], [4, k]], [[1, 1], [2, k], [5, k]]];
  if (n === 8) return [[[0, 1], [2, k], [4, k], [6, k]], [[1, 1], [2, k], [5, k], [7, k]]];
  const side = (first: number) => Array.from({ length: Math.ceil((n - first) / 2) }, (_, i): [number, number] => [first + 2 * i, 1]);
  return [side(0), side(1)];
}

/** planar PCM → [left, right]; mono plays on both sides */
export function toStereo(ch: Float32Array[]): Stereo {
  if (ch.length <= 2) return [ch[0] ?? new Float32Array(0), ch[1] ?? ch[0] ?? new Float32Array(0)];
  const n = ch[0].length;
  return stereoTaps(ch.length).map((taps) => {
    const norm = 1 / taps.reduce((s, [, w]) => s + w, 0);
    const out = new Float32Array(n);
    for (const [c, w] of taps) {
      const src = ch[c];
      const g = w * norm;
      for (let i = 0; i < n; i++) out[i] += src[i] * g;
    }
    return out;
  });
}

/** Continuous stereo at `rate` from source seconds [start, end), decoded window by window. */
export class PcmStream {
  private buf: Stereo = [new Float32Array(0), new Float32Array(0)];
  private resampler: Resampler | null = null;
  private cursor: number;

  constructor(
    private read: ReadPcm,
    start: number,
    private end: number,
    private rate: number,
  ) {
    this.cursor = start;
  }

  /** the next `n` frames, or fewer once the source runs out */
  async take(n: number): Promise<Stereo> {
    while (this.buf[0].length < n && this.cursor < this.end - EPS) {
      const to = Math.min(this.end, this.cursor + WINDOW);
      const pre = Math.min(PREROLL, this.cursor);
      const pcm = await this.read(this.cursor - pre, to);
      const skip = Math.round(pre * pcm.sampleRate);
      let planes = toStereo(pcm.channels).map((c) => c.subarray(Math.min(skip, c.length)));
      if (pcm.sampleRate !== this.rate && planes[0].length) {
        // one resampler for the whole stream keeps its phase across windows
        this.resampler ??= new Resampler(pcm.sampleRate / this.rate, 2);
        planes = this.resampler.process(planes);
      }
      this.buf = this.buf.map((b, c) => join(b, planes[c]));
      this.cursor = to;
    }
    const k = Math.min(n, this.buf[0].length);
    const out = this.buf.map((b) => b.slice(0, k));
    this.buf = this.buf.map((b) => b.subarray(k));
    return out;
  }
}

export interface MusicSource {
  take(n: number): Promise<Stereo>;
}

/** loops up to this long are decoded once and kept; longer ones are decoded again on each pass */
const LOOP_CACHE_SEC = 300;

/** The trimmed music from its first note on, repeating when `loop` is set. */
export async function musicSource(read: ReadPcm, seg: Segment, loop: boolean, rate: number): Promise<MusicSource> {
  if (loop && seg.end - seg.start <= LOOP_CACHE_SEC) {
    const all = await new PcmStream(read, seg.start, seg.end, rate).take(Math.ceil((seg.end - seg.start + 1) * rate));
    const len = all[0].length;
    let pos = 0;
    return {
      async take(n) {
        const out = [new Float32Array(n), new Float32Array(n)];
        if (!len) return out;
        for (let k = 0; k < n; k++) {
          out[0][k] = all[0][pos];
          out[1][k] = all[1][pos];
          if (++pos === len) pos = 0;
        }
        return out;
      },
    };
  }
  let stream = new PcmStream(read, seg.start, seg.end, rate);
  return {
    async take(n) {
      let got = await stream.take(n);
      while (loop && got[0].length < n) {
        stream = new PcmStream(read, seg.start, seg.end, rate);
        const more = await stream.take(n - got[0].length);
        if (!more[0].length) break;
        got = got.map((g, c) => join(g, more[c]));
      }
      return got;
    },
  };
}

// ---------------------------------------------------------------- mixing

const toInt16 = (x: number) => Math.round((x > 1 ? 1 : x < -1 ? -1 : x) * 32767);

/**
 * Mixes one block of the soundtrack into `out` (interleaved stereo int16) starting at video
 * frame `from`. `original` holds the video's sound for the same frames; `music` starts
 * `musicAt` frames into the block and is already looped, so this only applies gains and fades.
 */
export function mixBlock(out: Int16Array, p: MixPlan, rate: number, from: number, original: Stereo | null, music: Stereo | null, musicAt = 0) {
  const n = out.length / 2;
  const og = p.originalGain;
  const [oL, oR] = original && og > 0 ? original : [];
  const [mL, mR] = music ?? [];
  const mLen = mL?.length ?? 0;
  // the envelope only needs evaluating inside the fades; elsewhere it's flat 1
  const fadeInEnd = Math.round(p.offset * rate) + Math.round(p.fadeIn * rate);
  const fadeOutStart = Math.round((musicEnd(p) - p.fadeOut) * rate);
  for (let k = 0; k < n; k++) {
    const i = from + k;
    let l = 0;
    let r = 0;
    if (oL && k < oL.length) {
      l = oL[k] * og;
      r = oR[k] * og;
    }
    const m = k - musicAt;
    if (m >= 0 && m < mLen) {
      const g = i < fadeInEnd || i >= fadeOutStart ? p.musicGain * musicEnvelope(p, i / rate) : p.musicGain;
      l += mL[m] * g;
      r += mR[m] * g;
    }
    out[2 * k] = toInt16(l);
    out[2 * k + 1] = toInt16(r);
  }
}

/** 16-bit WAV sizes are 32-bit: about 6 hours of 48 kHz stereo */
const MAX_WAV_DATA = 0xffffffff - 36;
const BLOCK_SEC = 10;

/**
 * Renders the whole soundtrack as a stereo 16-bit WAV, block by block. Each block goes
 * straight into a Blob, so memory stays flat however long the video is.
 */
export async function renderMixWav(
  p: MixPlan,
  rate: number,
  music: MusicSource,
  original: PcmStream | null,
  ctl: { onProgress?: (p: number) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const frames = Math.max(1, Math.round(p.duration * rate));
  if (frames * 4 > MAX_WAV_DATA) throw new MediaError('invalid-options', 'This video is too long to mix in the browser. The limit is about 6 hours.');
  const off = Math.round(p.offset * rate);
  const end = Math.round(musicEnd(p) * rate);
  const block = BLOCK_SEC * rate;
  const parts: BlobPart[] = [wavHeader(frames, rate, 2)];
  let slice = performance.now();
  for (let i = 0; i < frames; i += block) {
    throwIfAborted(ctl.signal);
    const to = Math.min(frames, i + block);
    const orig = original && p.originalGain > 0 ? await original.take(to - i) : null;
    const a = Math.max(i, off);
    const b = Math.min(to, end);
    const mus = b > a ? await music.take(b - a) : null;
    const out = new Int16Array((to - i) * 2);
    mixBlock(out, p, rate, i, orig, mus, a - i);
    parts.push(new Blob([out]));
    ctl.onProgress?.(to / frames);
    // cached music never awaits anything, so let the page breathe now and then
    if (performance.now() - slice > 40) {
      await new Promise((r) => setTimeout(r, 0));
      slice = performance.now();
    }
  }
  throwIfAborted(ctl.signal);
  return new Blob(parts, { type: 'audio/wav' });
}

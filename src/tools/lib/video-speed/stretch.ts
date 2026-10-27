/**
 * Pitch-preserving time stretch (WSOLA: waveform-similarity overlap-add).
 *
 * The media engine changes speed tape-style, so the pitch follows the speed. To keep voices
 * sounding normal we stretch the soundtrack here and give it to transcode() as a replacement.
 * Input streams in as decoded chunks and comes out as 16-bit PCM in Blob pieces, so the page
 * holds a few hundred milliseconds of input and one 2 MB staging buffer; the browser's blob
 * store keeps the output (and can page it to disk), never the whole decoded track.
 */
export class TimeStretcher {
  /** output hop; frames are two hops long and overlap by half */
  readonly hop: number;
  private readonly step: number;
  private readonly tolerance: number;
  private readonly decimate: number;
  private readonly window: Float32Array;
  private readonly natural: Float32Array;
  private readonly region: Float32Array;
  private readonly acc: Float32Array[];

  private buf: Float32Array[];
  /** absolute input index of buf[c][0] */
  private base = 0;
  private len = 0;
  private inFrames = 0;
  private ended = false;
  private k = 0;
  private prevCenter = 0;
  private emitted = 0;

  private parts: Blob[] = [];
  private staging: Int16Array<ArrayBuffer>;
  private staged = 0;

  constructor(
    readonly speed: number,
    readonly sampleRate: number,
    readonly channels: number,
  ) {
    if (!(speed > 0)) throw new RangeError('speed must be positive');
    // 40 ms frames and ±10 ms of search suit both speech and music
    this.hop = Math.max(32, Math.round(sampleRate * 0.02));
    this.step = this.hop * speed;
    this.tolerance = Math.round(this.hop / 2);
    // the coarse search runs at roughly 4 kHz, then a fine pass at full rate around the best match
    this.decimate = Math.max(1, Math.round(sampleRate / 4000));
    const n = this.hop * 2;
    // periodic Hann: two half-overlapping windows sum to exactly 1
    this.window = Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    this.natural = new Float32Array(this.hop);
    this.region = new Float32Array(this.hop + 2 * this.tolerance);
    this.acc = Array.from({ length: channels }, () => new Float32Array(this.hop));
    this.buf = Array.from({ length: channels }, () => new Float32Array(sampleRate));
    this.staging = new Int16Array(1 << 20);
  }

  /** frames written so far */
  get outputFrames() {
    return this.emitted;
  }

  /** feeds one chunk (one Float32Array per channel) and processes every frame it completes */
  push(planes: Float32Array[]) {
    if (this.ended) throw new Error('push() after finish()');
    const n = planes[0]?.length ?? 0;
    if (!n) return;
    this.reserve(n);
    for (let c = 0; c < this.channels; c++) this.buf[c].set(planes[c] ?? planes[0], this.len);
    this.len += n;
    this.inFrames += n;
    while (this.base + this.len >= this.nominal(this.k) + this.tolerance + this.hop) this.frame();
    this.trim();
  }

  /** flushes the tail; the output is `input length / speed` frames long */
  finish() {
    if (this.ended) return;
    this.ended = true;
    const target = Math.round(this.inFrames / this.speed);
    while (this.emitted < target) this.frame(target);
    this.flush();
  }

  /** 16-bit PCM WAV of everything written; call after finish() */
  toWav(): Blob {
    const bytes = this.emitted * this.channels * 2;
    const head = new DataView(new ArrayBuffer(44));
    const text = (at: number, s: string) => [...s].forEach((ch, i) => head.setUint8(at + i, ch.charCodeAt(0)));
    text(0, 'RIFF');
    head.setUint32(4, 36 + bytes, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    head.setUint32(16, 16, true);
    head.setUint16(20, 1, true);
    head.setUint16(22, this.channels, true);
    head.setUint32(24, this.sampleRate, true);
    head.setUint32(28, this.sampleRate * this.channels * 2, true);
    head.setUint16(32, this.channels * 2, true);
    head.setUint16(34, 16, true);
    text(36, 'data');
    head.setUint32(40, bytes, true);
    return new Blob([head.buffer, ...this.parts], { type: 'audio/wav' });
  }

  private nominal(k: number) {
    return Math.round(k * this.step);
  }

  private at(c: number, i: number) {
    const j = i - this.base;
    return j >= 0 && j < this.len ? this.buf[c][j] : 0;
  }

  private mono(i: number) {
    let v = 0;
    for (let c = 0; c < this.channels; c++) v += this.at(c, i);
    return v;
  }

  /** where frame k should be centred: near its nominal spot, wherever it best continues the last frame */
  private bestCenter(): number {
    const nominal = this.nominal(this.k);
    if (this.k === 0) return nominal;
    const { hop, tolerance: tol, natural, region } = this;
    for (let j = 0; j < hop; j++) natural[j] = this.mono(this.prevCenter + j);
    const start = nominal - tol - hop;
    for (let j = 0; j < region.length; j++) region[j] = this.mono(start + j);

    // candidate δ starts at region[δ + tol]; score = normalised cross-correlation with `natural`
    const score = (delta: number, stride: number) => {
      let xy = 0;
      let yy = 0;
      for (let j = 0, r = delta + tol; j < hop; j += stride, r += stride) {
        const y = region[r];
        xy += natural[j] * y;
        yy += y * y;
      }
      return xy / Math.sqrt(yy + 1e-9);
    };
    const d = this.decimate;
    let best = 0;
    let bestScore = -Infinity;
    for (let delta = -tol; delta <= tol; delta += d) {
      const s = score(delta, d);
      if (s > bestScore) [best, bestScore] = [delta, s];
    }
    if (d > 1) {
      const coarse = best;
      bestScore = -Infinity;
      for (let delta = Math.max(-tol, coarse - d + 1); delta <= Math.min(tol, coarse + d - 1); delta++) {
        const s = score(delta, 2);
        if (s > bestScore) [best, bestScore] = [delta, s];
      }
    }
    return nominal + best;
  }

  /** overlap-adds frame k, which completes output [(k-1)·hop, k·hop) */
  private frame(limit = Infinity) {
    const center = this.bestCenter();
    const { hop, window: w } = this;
    const outStart = (this.k - 1) * hop;
    for (let i = 0; i < hop; i++) {
      const pos = outStart + i;
      for (let c = 0; c < this.channels; c++) {
        const acc = this.acc[c];
        const v = acc[i] + this.at(c, center - hop + i) * w[i];
        acc[i] = this.at(c, center + i) * w[hop + i];
        if (pos >= 0 && pos < limit) this.write(v);
      }
      if (pos >= 0 && pos < limit) this.emitted++;
    }
    this.prevCenter = center;
    this.k++;
  }

  private write(v: number) {
    const s = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
    this.staging[this.staged++] = s;
    if (this.staged === this.staging.length) this.flush();
  }

  private flush() {
    if (!this.staged) return;
    this.parts.push(new Blob([this.staging.subarray(0, this.staged)]));
    this.staged = 0;
  }

  /** drops input no future frame can reach */
  private trim() {
    const keepFrom = Math.min(this.prevCenter, this.nominal(this.k) - this.tolerance - this.hop);
    const drop = Math.min(this.len, keepFrom - this.base);
    if (drop <= 0) return;
    for (const b of this.buf) b.copyWithin(0, drop, this.len);
    this.base += drop;
    this.len -= drop;
  }

  private reserve(n: number) {
    const need = this.len + n;
    if (need <= this.buf[0].length) return;
    let size = this.buf[0].length;
    while (size < need) size *= 2;
    this.buf = this.buf.map((b) => {
      const next = new Float32Array(size);
      next.set(b.subarray(0, this.len));
      return next;
    });
  }
}

/** size of the 16-bit WAV the stretcher will hold in memory */
export const stretchedBytes = (durationSec: number, speed: number, sampleRate: number, channels: number) =>
  Math.ceil((durationSec / speed) * sampleRate) * channels * 2;

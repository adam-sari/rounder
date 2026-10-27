/** Small radix-2 FFT for analysis frames, plus the streaming pieces the analyzers share. */

export function hann(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}

export class Fft {
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;

  constructor(readonly size: number) {
    if (size < 2 || size & (size - 1)) throw new Error('FFT size must be a power of two');
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** magnitudes of bins 0…size/2 of `frame × window`, written into `out` */
  magnitudes(frame: Float32Array, window: Float32Array, out: Float32Array) {
    const { re, im, rev, cos, sin, size } = this;
    for (let i = 0; i < size; i++) {
      const j = rev[i];
      re[j] = frame[i] * window[i];
      im[j] = 0;
    }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const step = size / len;
      for (let i = 0; i < size; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = sin[k * step];
          const a = i + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let k = 0; k <= size / 2; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  }
}

/** cuts a sample stream into frames of `size` every `hop` samples, across push() calls */
export class Framer {
  private rest = new Float32Array(0);

  constructor(
    readonly size: number,
    readonly hop: number,
    private readonly onFrame: (frame: Float32Array) => void,
  ) {}

  push(x: Float32Array) {
    const buf = new Float32Array(this.rest.length + x.length);
    buf.set(this.rest);
    buf.set(x, this.rest.length);
    let pos = 0;
    for (; pos + this.size <= buf.length; pos += this.hop) this.onFrame(buf.subarray(pos, pos + this.size));
    this.rest = buf.slice(pos);
  }
}

/** rate the analysis runs at: plenty for beats and for pitches up to ~5 kHz */
export const ANALYSIS_RATE = 11025;

/**
 * Low-pass + downsample by an integer factor, streamed. Zero-phase (the filter is centred), so
 * output sample j lines up with input sample j × factor.
 */
export class Decimator {
  readonly factor: number;
  readonly rate: number;
  private readonly taps: Float32Array;
  private hist: Float32Array;

  constructor(inputRate: number) {
    this.factor = Math.max(1, Math.floor(inputRate / ANALYSIS_RATE));
    this.rate = inputRate / this.factor;
    const f = this.factor;
    const n = 16 * f + 1;
    const cutoff = 0.45 / f;
    this.taps = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - (n - 1) / 2;
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      const blackman = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
      this.taps[i] = sinc * blackman;
      sum += this.taps[i];
    }
    for (let i = 0; i < n; i++) this.taps[i] /= sum;
    this.hist = new Float32Array((n - 1) / 2);
  }

  push(x: Float32Array): Float32Array {
    if (this.factor === 1) return x;
    const { taps, factor } = this;
    const buf = new Float32Array(this.hist.length + x.length);
    buf.set(this.hist);
    buf.set(x, this.hist.length);
    const count = buf.length >= taps.length ? Math.floor((buf.length - taps.length) / factor) + 1 : 0;
    const out = new Float32Array(count);
    for (let j = 0; j < count; j++) {
      const at = j * factor;
      let acc = 0;
      for (let k = 0; k < taps.length; k++) acc += taps[k] * buf[at + k];
      out[j] = acc;
    }
    this.hist = buf.slice(count * factor);
    return out;
  }
}

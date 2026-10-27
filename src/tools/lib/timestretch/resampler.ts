/**
 * Streaming band-limited resampler (Blackman-windowed sinc, table lookup).
 *
 * `step` is how far the read position moves per output frame: 2 reads twice as fast, which
 * plays an octave higher in half the time. Unlike linear interpolation it low-passes below the
 * new Nyquist first, so pitching up doesn't fold the top end back down as metallic aliasing.
 */
export class SincResampler {
  private readonly half: number;
  private readonly table: Float32Array;
  private static readonly OVERSAMPLE = 512;

  private buf: Float32Array[];
  private base = 0;
  private len = 0;
  private inFrames = 0;
  /** next output frame */
  private k = 0;

  constructor(
    readonly step: number,
    readonly channels: number,
    zeroCrossings = 16,
  ) {
    if (!(step > 0)) throw new RangeError('step must be positive');
    // cutoff a little under the lower of the two Nyquists, leaving room for the transition band
    const fc = 0.9 * Math.min(1, 1 / step);
    this.half = Math.ceil(zeroCrossings / fc);
    const os = SincResampler.OVERSAMPLE;
    this.table = new Float32Array(this.half * os + 2);
    for (let j = 0; j < this.table.length; j++) {
      const x = j / os;
      if (x >= this.half) continue;
      const u = Math.PI * fc * x;
      const sinc = x === 0 ? 1 : Math.sin(u) / u;
      const r = x / this.half;
      const blackman = 0.42 + 0.5 * Math.cos(Math.PI * r) + 0.08 * Math.cos(2 * Math.PI * r);
      this.table[j] = fc * sinc * blackman;
    }
    this.buf = Array.from({ length: channels }, () => new Float32Array(4096));
  }

  push(planes: Float32Array[]): Float32Array[] {
    const n = planes[0]?.length ?? 0;
    this.reserve(n);
    for (let c = 0; c < this.channels; c++) this.buf[c].set(planes[c] ?? planes[0], this.len);
    this.len += n;
    this.inFrames += n;
    // an output frame needs input up to its position + half the kernel
    const end = this.base + this.len;
    const last = Math.floor((end - 1 - this.half) / this.step);
    const out = this.run(last + 1);
    const drop = Math.min(this.len, Math.floor(this.k * this.step) - this.half - this.base);
    if (drop > 0) {
      for (const b of this.buf) b.copyWithin(0, drop, this.len);
      this.base += drop;
      this.len -= drop;
    }
    return out;
  }

  /** the rest, reading silence past the end; total output is round(input ÷ step) frames */
  flush(): Float32Array[] {
    return this.run(Math.round(this.inFrames / this.step));
  }

  private run(until: number): Float32Array[] {
    const count = Math.max(0, until - this.k);
    const out = Array.from({ length: this.channels }, () => new Float32Array(count));
    const { half, table, step, base, len, channels } = this;
    const os = SincResampler.OVERSAMPLE;
    const acc = new Float64Array(channels);
    for (let o = 0; o < count; o++, this.k++) {
      const t = this.k * step;
      const lo = Math.max(base, Math.ceil(t - half));
      const hi = Math.min(base + len - 1, Math.floor(t + half));
      acc.fill(0);
      for (let i = lo; i <= hi; i++) {
        const x = Math.abs(t - i) * os;
        const j = x | 0;
        const h = table[j] + (table[j + 1] - table[j]) * (x - j);
        const at = i - base;
        for (let c = 0; c < channels; c++) acc[c] += this.buf[c][at] * h;
      }
      for (let c = 0; c < channels; c++) out[c][o] = acc[c];
    }
    return out;
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

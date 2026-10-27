import { FFT } from './fft';

/**
 * Streaming phase-vocoder time stretch with identity phase locking (Laroche & Dolson, 1999).
 *
 * Frames are analysed every `stretch`-th of the synthesis hop and overlap-added every hop.
 * Only spectral peaks get their phase advanced by their measured instantaneous frequency; every
 * other bin keeps its phase relation to the peak whose region it is in, which keeps partials
 * coherent and removes most of the classic "phasiness". Stereo stays coherent because the phase
 * rotation is computed once from the sum of both channels and applied to each. Onsets reset the
 * phases to the analysed ones so drum hits stay crisp instead of smearing.
 *
 * Supports one or two channels; two real channels share one complex FFT.
 */
export class PhaseVocoder {
  /** synthesis hop: a quarter frame */
  readonly hop: number;
  private readonly size: number;
  private readonly half: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  /** Hann² at 75 % overlap sums to 1.5; the FFT round trip adds a factor of `size` */
  private readonly scale: number;

  private readonly re: Float64Array;
  private readonly im: Float64Array;
  /** per-channel spectra, bins 0…half */
  private readonly xr: Float64Array[];
  private readonly xi: Float64Array[];
  private readonly mag: Float64Array;
  private readonly prevMag: Float64Array;
  private readonly phase: Float64Array;
  private readonly prevPhase: Float64Array;
  private readonly prevSynth: Float64Array;
  private readonly rotCos: Float64Array;
  private readonly rotSin: Float64Array;
  private readonly peaks: Int32Array;

  private buf: Float32Array[];
  /** absolute input index of buf[c][0] */
  private base = 0;
  private len = 0;
  private inFrames = 0;
  private ended = false;

  private readonly acc: Float64Array[];
  /** next frame index; frame t is centred on output t·hop */
  private t: number;
  private prevAnalysis: number | null = null;
  /** frames since the last phase reset */
  private sinceReset = 0;

  constructor(
    readonly stretch: number,
    readonly channels: 1 | 2,
    fftSize = 4096,
  ) {
    if (!(stretch > 0)) throw new RangeError('stretch must be positive');
    this.size = fftSize;
    this.half = fftSize >> 1;
    this.hop = fftSize >> 2;
    this.fft = new FFT(fftSize);
    this.window = Float64Array.from({ length: fftSize }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize));
    this.scale = 1 / (1.5 * fftSize);
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
    const bins = () => new Float64Array(this.half + 1);
    this.xr = [bins(), bins()];
    this.xi = [bins(), bins()];
    this.mag = bins();
    this.prevMag = bins();
    this.phase = bins();
    this.prevPhase = bins();
    this.prevSynth = bins();
    this.rotCos = bins();
    this.rotSin = bins();
    this.peaks = new Int32Array(this.half);
    this.buf = Array.from({ length: channels }, () => new Float32Array(fftSize * 4));
    this.acc = Array.from({ length: channels }, () => new Float64Array(fftSize));
    // the first frame whose window reaches output sample 0
    this.t = 1 - this.half / this.hop;
  }

  /** feeds input and returns whatever output that completes */
  push(planes: Float32Array[]): Float32Array[] {
    if (this.ended) throw new Error('push() after flush()');
    const n = planes[0]?.length ?? 0;
    this.reserve(n);
    for (let c = 0; c < this.channels; c++) this.buf[c].set(planes[c] ?? planes[0], this.len);
    this.len += n;
    this.inFrames += n;
    const out = this.makeOut(Math.ceil(n * this.stretch / this.hop) + 2);
    let written = 0;
    while (this.analysisAt(this.t) + this.half <= this.base + this.len) written = this.frame(out, written, Infinity);
    this.trim();
    return out.map((o) => o.subarray(0, written));
  }

  /** processes the tail; total output is round(input × stretch) frames */
  flush(): Float32Array[] {
    this.ended = true;
    const total = Math.round(this.inFrames * this.stretch);
    const out = this.makeOut(Math.ceil((total - this.done()) / this.hop) + 1);
    let written = 0;
    while (this.done() < total) written = this.frame(out, written, total);
    return out.map((o) => o.subarray(0, written));
  }

  /** output samples final so far (some may be negative positions, never emitted) */
  private done() {
    return this.t * this.hop - this.half;
  }

  private analysisAt(t: number) {
    return Math.round((t * this.hop) / this.stretch);
  }

  private makeOut(frames: number) {
    return Array.from({ length: this.channels }, () => new Float32Array(Math.max(0, frames) * this.hop));
  }

  private frame(out: Float32Array[], written: number, limit: number): number {
    const { size, half, hop, re, im, window: w } = this;
    const a = this.analysisAt(this.t);
    const from = a - half - this.base;

    // window both channels into one complex buffer: left real, right imaginary
    for (let i = 0; i < size; i++) {
      const j = from + i;
      const inside = j >= 0 && j < this.len;
      re[i] = inside ? this.buf[0][j] * w[i] : 0;
      im[i] = inside && this.channels === 2 ? this.buf[1][j] * w[i] : 0;
    }
    this.fft.forward(re, im);
    this.split();
    this.rotate(a);
    this.join();
    this.fft.inverse(re, im);

    const s = this.scale;
    for (let c = 0; c < this.channels; c++) {
      const acc = this.acc[c];
      const y = c === 0 ? re : im;
      for (let i = 0; i < size; i++) acc[i] += y[i] * w[i] * s;
    }

    // the first hop of the accumulator can't receive anything more: emit it and slide
    const start = this.done();
    for (let i = 0; i < hop; i++) {
      const pos = start + i;
      if (pos < 0 || pos >= limit) continue;
      for (let c = 0; c < this.channels; c++) out[c][written] = this.acc[c][i];
      written++;
    }
    for (const acc of this.acc) {
      acc.copyWithin(0, hop);
      acc.fill(0, size - hop);
    }
    this.prevAnalysis = a;
    this.t++;
    return written;
  }

  /** separates the two real channels' spectra from the packed complex FFT */
  private split() {
    const { size, half, re, im, xr, xi, mag, phase } = this;
    for (let k = 0; k <= half; k++) {
      const m = (size - k) & (size - 1);
      const zr = re[k];
      const zi = im[k];
      const wr = re[m];
      const wi = im[m];
      let mr: number;
      let mi: number;
      if (this.channels === 2) {
        xr[0][k] = (zr + wr) / 2;
        xi[0][k] = (zi - wi) / 2;
        xr[1][k] = (zi + wi) / 2;
        xi[1][k] = (wr - zr) / 2;
        mr = xr[0][k] + xr[1][k];
        mi = xi[0][k] + xi[1][k];
      } else {
        xr[0][k] = mr = zr;
        xi[0][k] = mi = zi;
      }
      mag[k] = Math.sqrt(mr * mr + mi * mi);
      phase[k] = Math.atan2(mi, mr);
    }
  }

  /** works out each bin's phase rotation from the channel sum */
  private rotate(analysis: number) {
    const { half, hop, mag, prevMag, phase, prevPhase, prevSynth, rotCos, rotSin, peaks } = this;
    const ha = this.prevAnalysis === null ? 0 : analysis - this.prevAnalysis;
    const reset = ha <= 0 || this.isOnset();
    this.sinceReset = reset ? 0 : this.sinceReset + 1;

    let count = 0;
    if (!reset) {
      for (let k = 1; k < half; k++) {
        const m = mag[k];
        if (m > mag[k - 1] && m >= mag[k + 1] && (k < 2 || m > mag[k - 2]) && (k + 2 > half || m >= mag[k + 2])) peaks[count++] = k;
      }
    }

    rotCos.fill(1);
    rotSin.fill(0);
    if (count === 0) {
      prevSynth.set(phase);
    } else {
      let lo = 1;
      for (let n = 0; n < count; n++) {
        const p = peaks[n];
        const omega = (2 * Math.PI * p) / this.size;
        const dev = wrap(phase[p] - prevPhase[p] - omega * ha);
        const synth = prevSynth[p] + (omega + dev / ha) * hop;
        const theta = wrap(synth - phase[p]);
        // region of influence: up to the quietest bin before the next peak
        let hi = half - 1;
        if (n + 1 < count) {
          hi = p;
          for (let k = p + 1; k < peaks[n + 1]; k++) if (mag[k] < mag[hi]) hi = k;
        }
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        for (let k = lo; k <= hi; k++) {
          rotCos[k] = c;
          rotSin[k] = s;
          prevSynth[k] = wrap(phase[k] + theta);
        }
        lo = hi + 1;
      }
      // DC and Nyquist stay real
      prevSynth[0] = phase[0];
      prevSynth[half] = phase[half];
    }
    prevPhase.set(phase);
    prevMag.set(mag);
  }

  /**
   * Onset test: share of the spectrum's energy in bins that jumped by more than 3 dB since the
   * last frame. Steady tones score near zero, drum hits and plucks score high.
   */
  private isOnset() {
    if (this.sinceReset < 2) return false;
    const { half, mag, prevMag } = this;
    let rising = 0;
    let total = 0;
    for (let k = 1; k < half; k++) {
      const m = mag[k];
      total += m;
      if (m > 1.41 * prevMag[k]) rising += m;
    }
    return total > 1e-6 && rising / total > 0.35;
  }

  /** applies the rotation and repacks both channels into one Hermitian-pair spectrum */
  private join() {
    const { size, half, re, im, xr, xi, rotCos, rotSin } = this;
    const stereo = this.channels === 2;
    for (let k = 0; k <= half; k++) {
      const c = rotCos[k];
      const s = rotSin[k];
      const ar = xr[0][k] * c - xi[0][k] * s;
      const ai = xr[0][k] * s + xi[0][k] * c;
      const br = stereo ? xr[1][k] * c - xi[1][k] * s : 0;
      const bi = stereo ? xr[1][k] * s + xi[1][k] * c : 0;
      if (k === 0 || k === half) {
        re[k] = ar;
        im[k] = br;
        continue;
      }
      re[k] = ar - bi;
      im[k] = ai + br;
      re[size - k] = ar + bi;
      im[size - k] = br - ai;
    }
  }

  /** drops input no future frame can reach */
  private trim() {
    const drop = Math.min(this.len, this.analysisAt(this.t) - this.half - this.base);
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

const TAU = 2 * Math.PI;
const wrap = (x: number) => x - TAU * Math.round(x / TAU);

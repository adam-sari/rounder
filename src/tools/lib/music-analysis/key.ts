import { Fft, Framer, hann } from './fft';

/*
 * Musical key. Spectral peaks between ~60 Hz and 2.1 kHz are folded into a 10-cent pitch-class
 * histogram; its circular mean gives the tuning offset (for records not tuned to A440), then
 * it's folded into 12 pitch classes and correlated with the Krumhansl–Kessler key profiles.
 */

const SIZE = 4096;
const HOP = 2048;
const FINE = 120; // 10-cent bins per octave
const LOW_HZ = 60;
const HIGH_HZ = 2100;

const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

// Krumhansl & Kessler (1982) probe-tone ratings, tonic first
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export type Mode = 'major' | 'minor';

/** streaming pitch-class histogram; feed it audio at the analysis rate */
export class ChromaAccumulator {
  private readonly fine = new Float64Array(FINE);
  private readonly framer: Framer;

  constructor(readonly rate: number) {
    const size = rate > 13000 ? SIZE * 2 : SIZE;
    const fft = new Fft(size);
    const win = hann(size);
    const mag = new Float32Array(size / 2 + 1);
    const lo = Math.max(2, Math.floor((LOW_HZ * size) / rate));
    const hi = Math.min(size / 2 - 1, Math.ceil((Math.min(HIGH_HZ, rate * 0.45) * size) / rate));
    this.framer = new Framer(size, size === SIZE ? HOP : HOP * 2, (frame) => {
      fft.magnitudes(frame, win, mag);
      let top = 0;
      for (let k = lo; k <= hi; k++) if (mag[k] > top) top = mag[k];
      const floor = Math.max(1e-4, top * 0.02);
      for (let k = lo; k <= hi; k++) {
        const b = mag[k];
        if (b < floor || b <= mag[k - 1] || b < mag[k + 1]) continue;
        // parabolic interpolation finds the true peak frequency between bins
        const a = mag[k - 1];
        const c = mag[k + 1];
        const den = a - 2 * b + c;
        const shift = den ? (0.5 * (a - c)) / den : 0;
        const hz = ((k + shift) * rate) / size;
        this.add(hz, b);
      }
    });
  }

  private add(hz: number, weight: number) {
    const midi = 69 + 12 * Math.log2(hz / 440);
    const pos = (((midi * 10) % FINE) + FINE) % FINE;
    const i = Math.floor(pos);
    const f = pos - i;
    this.fine[i] += weight * (1 - f);
    this.fine[(i + 1) % FINE] += weight * f;
  }

  push(x: Float32Array) {
    this.framer.push(x);
  }

  /** 12 pitch-class strengths (C first) and the detected tuning offset in cents */
  result(): { chroma: Float64Array; tuningCents: number } {
    return foldChroma(this.fine);
  }
}

export function foldChroma(fine: Float64Array): { chroma: Float64Array; tuningCents: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < FINE; i++) {
    const phase = ((i % 10) / 10) * 2 * Math.PI;
    x += fine[i] * Math.cos(phase);
    y += fine[i] * Math.sin(phase);
  }
  const tuningCents = x || y ? (Math.atan2(y, x) / (2 * Math.PI)) * 100 : 0;
  const shift = Math.round(tuningCents / 10);
  const chroma = new Float64Array(12);
  for (let pc = 0; pc < 12; pc++) {
    for (let j = -5; j <= 5; j++) {
      const w = Math.abs(j) === 5 ? 0.5 : 1;
      chroma[pc] += w * fine[(((pc * 10 + shift + j) % FINE) + FINE) % FINE];
    }
  }
  return { chroma, tuningCents };
}

function correlate(chroma: ArrayLike<number>, profile: number[], tonic: number) {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += chroma[(i + tonic) % 12];
    mb += profile[i];
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const a = chroma[(i + tonic) % 12] - ma;
    const b = profile[i] - mb;
    num += a * b;
    da += a * a;
    db += b * b;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export interface KeyId {
  /** pitch class of the tonic, C = 0 */
  tonic: number;
  mode: Mode;
}

export interface KeyCandidate extends KeyId {
  /** Pearson correlation with the key profile, −1…1 */
  score: number;
}

export interface Key extends KeyCandidate {
  /** 0–1: how clearly it beats the runner-up */
  confidence: number;
  /** the next most likely keys, best first */
  runnersUp: KeyCandidate[];
  tuningCents: number;
}

export function detectKey(chroma: ArrayLike<number>, tuningCents = 0): Key | null {
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i];
  if (!(total > 0)) return null;
  const all: KeyCandidate[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    all.push({ tonic, mode: 'major', score: correlate(chroma, MAJOR_PROFILE, tonic) });
    all.push({ tonic, mode: 'minor', score: correlate(chroma, MINOR_PROFILE, tonic) });
  }
  all.sort((a, b) => b.score - a.score);
  const [best, second] = all;
  // a gap of 0.1 in correlation is a clear win; a weak best match caps it
  const confidence = Math.min(1, Math.max(0, (best.score - second.score) / 0.1)) * Math.min(1, Math.max(0, best.score / 0.6));
  return { ...best, confidence, runnersUp: all.slice(1, 4), tuningCents };
}

/** "A minor", "F♯ major"; `ascii` swaps ♯/♭ for #/b (for CSV files) */
export function keyName(k: KeyId, ascii = false): string {
  const name = `${(k.mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[k.tonic]} ${k.mode}`;
  return ascii ? name.replace('♯', '#').replace('♭', 'b') : name;
}

/** "Am", "F♯", the short form on DJ software and chord charts */
export function keyShort(k: KeyId): string {
  return `${(k.mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[k.tonic]}${k.mode === 'minor' ? 'm' : ''}`;
}

/** relative minor of a major key and vice versa: same notes, different home */
export function relativeKey(k: KeyId): KeyId {
  return k.mode === 'major' ? { tonic: (k.tonic + 9) % 12, mode: 'minor' } : { tonic: (k.tonic + 3) % 12, mode: 'major' };
}

/** Camelot wheel code: C major = 8B, A minor = 8A; neighbours on the wheel mix harmonically */
export function camelot(k: KeyId): string {
  const major = k.mode === 'major' ? k.tonic : (k.tonic + 3) % 12;
  return `${((((7 * major) % 12) + 7) % 12) + 1}${k.mode === 'major' ? 'B' : 'A'}`;
}

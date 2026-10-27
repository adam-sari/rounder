/*
 * Plans the pieces of audio Whisper hears. Whisper reads 30 seconds at a time and tends to
 * invent words over silence, so the audio is cut where people pause: silent stretches are
 * skipped, speech is packed into windows of at most `maxSec`, and a long unbroken stretch is
 * cut at its quietest moment.
 */

export const SAMPLE_RATE = 16_000;

/** sample offsets into the audio */
export interface Window {
  start: number;
  end: number;
}

export interface WindowOptions {
  maxSec: number;
  /** a pause at least this long ends a stretch of speech */
  pauseSec: number;
  /** a gap at least this long starts a new window rather than riding along in this one */
  splitGapSec: number;
  /** context kept around each stretch of speech */
  padSec: number;
}

export const WINDOWS: WindowOptions = { maxSec: 28, pauseSec: 0.5, splitGapSec: 3, padSec: 0.25 };

const FRAME_SEC = 0.02;
/** below this level (dBFS) a frame is silence however quiet the rest is */
const FLOOR_DB = -55;

/** loudness of each 20 ms frame, in dBFS */
export function frameLevels(audio: Float32Array, rate = SAMPLE_RATE): Float32Array {
  const size = Math.round(rate * FRAME_SEC);
  const out = new Float32Array(Math.ceil(audio.length / size));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    const end = Math.min(audio.length, (f + 1) * size);
    for (let i = f * size; i < end; i++) sum += audio[i] * audio[i];
    out[f] = 10 * Math.log10(sum / Math.max(1, end - f * size) + 1e-10);
  }
  return out;
}

function percentile(values: Float32Array, p: number) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -100;
}

/** Splits [a, b) (in frames) into pieces no longer than `max` frames, each cut at the quietest frame in its last 40% */
function cutLong(a: number, b: number, max: number, levels: Float32Array): [number, number][] {
  const out: [number, number][] = [];
  while (b - a > max) {
    let cut = a + max;
    for (let f = a + Math.floor(max * 0.6); f < a + max; f++) if (levels[f] < levels[cut]) cut = f;
    out.push([a, cut]);
    a = cut;
  }
  out.push([a, b]);
  return out;
}

export function planWindows(audio: Float32Array, rate = SAMPLE_RATE, o: WindowOptions = WINDOWS): Window[] {
  const levels = frameLevels(audio, rate);
  if (!levels.length) return [];
  const quiet = percentile(levels, 0.1);
  const loud = percentile(levels, 0.95);
  if (loud < FLOOR_DB) return [];
  // speech sits well above the noise floor; a steady bed (music, hum) leaves everything "voiced"
  const threshold = Math.max(FLOOR_DB, quiet + (loud - quiet) * 0.25);

  const perSec = 1 / FRAME_SEC;
  const pause = Math.round(o.pauseSec * perSec);
  const pad = Math.round(o.padSec * perSec);
  const max = Math.floor(o.maxSec * perSec);

  // stretches of speech, bridging pauses shorter than `pause`, padded on both sides
  const stretches: [number, number][] = [];
  let start = -1;
  let lastVoiced = -1;
  for (let f = 0; f <= levels.length; f++) {
    const voiced = f < levels.length && levels[f] > threshold;
    if (voiced) {
      if (start < 0) start = f;
      else if (f - lastVoiced > pause) {
        stretches.push([start, lastVoiced + 1]);
        start = f;
      }
      lastVoiced = f;
    }
  }
  if (start >= 0) stretches.push([start, lastVoiced + 1]);
  const padded: [number, number][] = [];
  for (const [a, b] of stretches) {
    // a lone click isn't speech
    if (b - a < 0.1 * perSec) continue;
    const s = Math.max(0, a - pad);
    const e = Math.min(levels.length, b + pad);
    const prev = padded.at(-1);
    if (prev && s <= prev[1]) prev[1] = e;
    else padded.push([s, e]);
  }

  // pack stretches into windows
  const windows: [number, number][] = [];
  for (const [a, b] of padded.flatMap(([a, b]) => cutLong(a, b, max, levels))) {
    const cur = windows.at(-1);
    if (cur && a - cur[1] < o.splitGapSec * perSec && b - cur[0] <= max) cur[1] = b;
    else windows.push([a, b]);
  }

  const size = Math.round(rate * FRAME_SEC);
  return windows.map(([a, b]) => ({ start: a * size, end: Math.min(audio.length, b * size) }));
}

/** seconds of audio the windows cover, for progress */
export const windowsDuration = (windows: Window[], rate = SAMPLE_RATE) => windows.reduce((s, w) => s + (w.end - w.start), 0) / rate;

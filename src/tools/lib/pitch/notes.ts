/** Equal-temperament note maths, relative to an adjustable A4. MIDI numbers: A4 = 69, middle C = 60. */

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

export const A4_MIN = 432;
export const A4_MAX = 446;

export const midiToFreq = (midi: number, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
export const freqToMidi = (freq: number, a4 = 440) => 69 + 12 * Math.log2(freq / a4);
export const cents = (freq: number, ref: number) => 1200 * Math.log2(freq / ref);

export function noteName(midi: number) {
  const m = Math.round(midi);
  return { name: NOTE_NAMES[((m % 12) + 12) % 12], octave: Math.floor(m / 12) - 1 };
}

/** the nearest note to a frequency and how far off it is, in cents (−50…+50) */
export function nearestNote(freq: number, a4 = 440) {
  const exact = freqToMidi(freq, a4);
  const midi = Math.round(exact);
  return { midi, ...noteName(midi), cents: (exact - midi) * 100 };
}

/** "E2", "C#4", "Bb3" → MIDI number */
export function parseNote(s: string): number {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(s.trim());
  if (!m) throw new Error(`Not a note: ${s}`);
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase() as 'c'];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

export const clampA4 = (v: number) => (Number.isFinite(v) ? Math.min(A4_MAX, Math.max(A4_MIN, Math.round(v))) : 440);

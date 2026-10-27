/* Settings ranges and the words and file names shown for them. */

export const MAX_SEMITONES = 12;
export const MAX_CENTS = 50;

export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export type Key = (typeof KEYS)[number];

const INTERVALS = ['', 'half step', 'whole step', 'minor third', 'major third', 'perfect fourth', 'tritone', 'perfect fifth', 'minor sixth', 'major sixth', 'minor seventh', 'major seventh', 'octave'];

/** 7 → "perfect fifth up", -2 → "whole step down" */
export function intervalName(semitones: number): string {
  const n = Math.round(semitones);
  if (n === 0) return 'original pitch';
  return `${INTERVALS[Math.min(12, Math.abs(n))]} ${n > 0 ? 'up' : 'down'}`;
}

/** the key a song ends up in: transposeKey('A', 3) → 'C' */
export const transposeKey = (key: Key, semitones: number): Key => KEYS[(((KEYS.indexOf(key) + Math.round(semitones)) % 12) + 12) % 12];

/** total shift in semitones, e.g. 2 st − 25 ct → 1.75 */
export const totalSemitones = (semitones: number, cents: number) => Math.round((semitones + cents / 100) * 100) / 100;

/** "+2 semitones", "−1.25 semitones" */
export function semitoneLabel(total: number): string {
  if (total === 0) return '0 semitones';
  const sign = total > 0 ? '+' : '−';
  return `${sign}${Math.abs(total)} semitone${Math.abs(total) === 1 ? '' : 's'}`;
}

/** "-pitch+2", "-pitch-3.25" for file names */
export const pitchSuffix = (semitones: number, cents: number) => {
  const t = totalSemitones(semitones, cents);
  return `-pitch${t >= 0 ? '+' : ''}${t}`;
};

export const MIN_TEMPO = 0.5;
export const MAX_TEMPO = 2;
export const TEMPO_PRESETS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

export const clampTempo = (t: number) => (Number.isFinite(t) ? Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(t * 100) / 100)) : 1);

/** the slider is logarithmic so 0.5× and 2× sit the same distance from 1× */
export const tempoToSlider = (t: number) => Math.log2(clampTempo(t));
export const sliderToTempo = (v: number) => clampTempo(2 ** v);

/** "-1.25x" for file names */
export const tempoSuffix = (t: number) => `-${clampTempo(t)}x`;

/** how a tempo change moves the pitch on a record player, in semitones */
export const tapeSemitones = (tempo: number) => Math.round(12 * Math.log2(tempo) * 10) / 10;

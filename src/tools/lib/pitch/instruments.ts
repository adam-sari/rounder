import { cents, midiToFreq, parseNote } from './notes';

export interface Instrument {
  id: string;
  name: string;
  /** open strings, lowest-pitched string first (ukulele's re-entrant G comes first as on the neck) */
  strings: string[];
  /** detection range in Hz */
  minFreq: number;
  maxFreq: number;
}

export const INSTRUMENTS: Instrument[] = [
  { id: 'guitar', name: 'Guitar · standard', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], minFreq: 60, maxFreq: 1000 },
  { id: 'drop-d', name: 'Guitar · drop D', strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'], minFreq: 55, maxFreq: 1000 },
  { id: 'dadgad', name: 'Guitar · DADGAD', strings: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'], minFreq: 55, maxFreq: 1000 },
  { id: 'ukulele', name: 'Ukulele · GCEA', strings: ['G4', 'C4', 'E4', 'A4'], minFreq: 150, maxFreq: 1200 },
  { id: 'bass', name: 'Bass · 4 string', strings: ['E1', 'A1', 'D2', 'G2'], minFreq: 30, maxFreq: 500 },
  { id: 'violin', name: 'Violin', strings: ['G3', 'D4', 'A4', 'E5'], minFreq: 150, maxFreq: 2000 },
  { id: 'chromatic', name: 'Chromatic', strings: [], minFreq: 30, maxFreq: 2000 },
];

export const instrumentById = (id: string) => INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];

export interface Target {
  index: number;
  midi: number;
  freq: number;
}

export const stringTargets = (inst: Instrument, a4 = 440): Target[] =>
  inst.strings.map((s, index) => {
    const midi = parseNote(s);
    return { index, midi, freq: midiToFreq(midi, a4) };
  });

/** the string whose open note is closest to the pitch, in cents */
export function closestString(freq: number, targets: Target[]): Target | null {
  let best: Target | null = null;
  for (const t of targets) if (!best || Math.abs(cents(freq, t.freq)) < Math.abs(cents(freq, best.freq))) best = t;
  return best;
}

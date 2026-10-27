/** Pure rhythm logic for the metronome: meters, accents, tap tempo, the tempo trainer and the tick planner. */

export const BPM_MIN = 20;
export const BPM_MAX = 300;

export const clampBpm = (v: number) => (Number.isFinite(v) ? Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(v))) : 120);

/** 0 silent, 1 normal, 2 medium accent, 3 strong accent */
export type Level = 0 | 1 | 2 | 3;
export type Sound = 'accent' | 'medium' | 'beat' | 'sub';

export interface Meter {
  beats: number;
  /** the note value that gets the beat: 2, 4, 8 or 16 */
  unit: number;
}

export const SIGNATURES = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8'] as const;
export const UNITS = [2, 4, 8, 16] as const;
export const BEATS_MAX = 16;

export function parseSignature(s: string): Meter {
  const [beats, unit] = s.split('/').map(Number);
  return { beats, unit };
}

/**
 * Starting accents for a meter. Eighth-note meters are felt in groups: 6/8 as 3+3, 7/8 as
 * 2+2+3, and other multiples of three as threes, with a lighter accent on each group.
 */
export function defaultAccents({ beats, unit }: Meter, accentFirst = true): Level[] {
  const levels: Level[] = Array(beats).fill(1);
  if (unit === 8 && beats === 7) levels[2] = levels[4] = 2;
  else if (unit === 8 && beats > 3 && beats % 3 === 0) for (let i = 3; i < beats; i += 3) levels[i] = 2;
  if (accentFirst) levels[0] = 3;
  return levels;
}

/** what each count of a beat is called, e.g. 2 subdivisions of a quarter-note beat are 8ths */
export function subdivisionName(unit: number, subs: number): string {
  if (subs === 1) return 'off';
  if (subs === 3) return 'triplets';
  const note = unit * subs;
  return note === 4 ? 'quarters' : note === 2 ? 'halves' : note === 32 ? '32nds' : `${note}ths`;
}

/** BPM from tap times in ms; uses the last few taps so a steadying hand wins out */
export function tapTempo(times: number[], window = 6): number | null {
  const recent = times.slice(-(window + 1));
  if (recent.length < 2) return null;
  const span = recent[recent.length - 1] - recent[0];
  return span > 0 ? clampBpm((60_000 * (recent.length - 1)) / span) : null;
}

/** taps further apart than this start a new count */
export const TAP_RESET_MS = 2000;

export interface Trainer {
  on: boolean;
  /** BPM added at each step (positive) */
  step: number;
  /** bars between steps */
  every: number;
  /** stop climbing here */
  target: number;
}

/** tempo for a 0-based bar when the trainer climbs from `start`; bars before the trainer began are negative */
export function trainerBpm(start: number, bar: number, t: Trainer): number {
  if (!t.on || t.every < 1) return start;
  // a target at or below the start tempo just holds the start tempo
  return Math.max(start, Math.min(start + Math.floor(bar / t.every) * t.step, t.target));
}

/** a loose name for the tempo, using common Italian markings */
export function tempoName(bpm: number): string {
  const marks: [number, string][] = [
    [40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'],
    [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto'],
  ];
  return marks.find(([below]) => bpm < below)?.[1] ?? 'Prestissimo';
}

export interface Pos {
  /** 0-based bar since start */
  bar: number;
  beat: number;
  sub: number;
}

export interface Pattern {
  bpm: number;
  accents: Level[];
  /** clicks per beat */
  subs: number;
}

export interface Tick extends Pos {
  /** AudioContext seconds */
  time: number;
  sound: Sound | null;
}

export function soundFor(pos: Pos, accents: Level[]): Sound | null {
  if (pos.sub > 0) return 'sub';
  return ([null, 'beat', 'medium', 'accent'] as const)[accents[pos.beat] ?? 1];
}

/**
 * The heart of the lookahead scheduler: lays out every tick that starts before `until`. The
 * pattern is read afresh for each tick, so tempo, meter and subdivision changes land on the
 * very next click without restarting.
 */
export class TickPlanner {
  pos: Pos = { bar: 0, beat: 0, sub: 0 };

  constructor(public time: number) {}

  plan(until: number, pattern: (pos: Pos) => Pattern): Tick[] {
    const out: Tick[] = [];
    while (this.time < until) {
      const p = pattern(this.pos);
      // the meter or subdivision may have shrunk since the last tick
      if (this.pos.beat >= p.accents.length) this.pos = { bar: this.pos.bar + 1, beat: 0, sub: 0 };
      else if (this.pos.sub >= p.subs) this.pos = this.next({ ...this.pos, sub: p.subs - 1 }, p);
      out.push({ ...this.pos, time: this.time, sound: soundFor(this.pos, p.accents) });
      this.time += 60 / p.bpm / p.subs;
      this.pos = this.next(this.pos, p);
    }
    return out;
  }

  private next({ bar, beat, sub }: Pos, p: Pattern): Pos {
    if (sub + 1 < p.subs) return { bar, beat, sub: sub + 1 };
    if (beat + 1 < p.accents.length) return { bar, beat: beat + 1, sub: 0 };
    return { bar: bar + 1, beat: 0, sub: 0 };
  }
}

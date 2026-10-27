export type Phase = 'work' | 'short' | 'long';

export interface PomodoroSettings {
  /** minutes */
  work: number;
  short: number;
  long: number;
  /** a long break after this many focus sessions */
  longEvery: number;
  autoBreaks: boolean;
  autoWork: boolean;
}

export const defaults: PomodoroSettings = { work: 25, short: 5, long: 15, longEvery: 4, autoBreaks: true, autoWork: false };

/** after a phase ends: which phase is next, and how many focus sessions are done in this round */
export function advance(phase: Phase, done: number, longEvery: number): { phase: Phase; done: number } {
  if (phase !== 'work') return { phase: 'work', done: phase === 'long' ? 0 : done };
  const next = done + 1;
  return { phase: next >= Math.max(1, longEvery) ? 'long' : 'short', done: next };
}

export interface Tally {
  day: string;
  sessions: number;
  /** focus minutes */
  minutes: number;
}

/** adds a finished focus session to today's tally, starting fresh on a new day */
export function addToTally(t: Tally | null, day: string, minutes: number): Tally {
  const base = t?.day === day ? t : { day, sessions: 0, minutes: 0 };
  return { day, sessions: base.sessions + 1, minutes: base.minutes + minutes };
}

export const todays = (t: Tally | null, day: string): Tally => (t?.day === day ? t : { day, sessions: 0, minutes: 0 });

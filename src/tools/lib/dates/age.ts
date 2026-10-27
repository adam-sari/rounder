import { addDays, addMonths, compare, span, toDays, type Overflow, type Ymd } from './civil';

export interface Age {
  years: number;
  months: number;
  days: number;
  /** leftover hours, minutes and seconds past the last whole day (only with a birth time) */
  hours: number;
  minutes: number;
  seconds: number;
  totalMonths: number;
  totalWeeks: number;
  totalDays: number;
  totalHours: number;
  totalSeconds: number;
}

export interface AgeOptions {
  /** seconds after midnight the person was born, if known */
  birthTime?: number | null;
  /** seconds after midnight on the target date; only used with a birth time */
  time?: number;
  /** when a Feb 29 birthday is marked in common years: Feb 28 (clamp) or Mar 1 (roll) */
  leap?: Overflow;
}

const DAY = 86_400;

/** exact age on a date, or null if the person isn't born yet */
export function ageOn(birth: Ymd, on: Ymd, { birthTime = null, time = 0, leap = 'clamp' }: AgeOptions = {}): Age | null {
  const hasTime = birthTime != null;
  const totalSeconds = (toDays(on) - toDays(birth)) * DAY + (hasTime ? time - birthTime : 0);
  if (totalSeconds < 0) return null;
  // before the birth time of day, the last day isn't complete yet
  const lastWholeDay = hasTime && time < birthTime ? addDays(on, -1) : on;
  const rest = totalSeconds % DAY;
  const s = span(birth, lastWholeDay, leap);
  const totalDays = Math.floor(totalSeconds / DAY);
  return {
    years: s.years,
    months: s.months,
    days: s.days,
    hours: Math.floor(rest / 3600),
    minutes: Math.floor((rest % 3600) / 60),
    seconds: rest % 60,
    totalMonths: s.totalMonths,
    totalWeeks: Math.floor(totalDays / 7),
    totalDays,
    totalHours: Math.floor(totalSeconds / 3600),
    totalSeconds,
  };
}

export interface Birthday {
  date: Ymd;
  /** the age they turn on that day */
  turning: number;
  /** days from `on` until then; 0 means today */
  inDays: number;
}

/** the next birthday on or after `on` (birth must not be after `on`) */
export function nextBirthday(birth: Ymd, on: Ymd, leap: Overflow = 'clamp'): Birthday {
  const { years } = span(birth, on, leap);
  const latest = addMonths(birth, years * 12, leap);
  const turning = years > 0 && compare(latest, on) === 0 ? years : years + 1;
  const date = addMonths(birth, turning * 12, leap);
  return { date, turning, inDays: toDays(date) - toDays(on) };
}

// [month, first day] each sign begins on; the exact switch-over can shift by a day from year to year
const SIGNS: [number, number, string, string][] = [
  [1, 20, 'Aquarius', '♒'], [2, 19, 'Pisces', '♓'], [3, 21, 'Aries', '♈'], [4, 20, 'Taurus', '♉'],
  [5, 21, 'Gemini', '♊'], [6, 21, 'Cancer', '♋'], [7, 23, 'Leo', '♌'], [8, 23, 'Virgo', '♍'],
  [9, 23, 'Libra', '♎'], [10, 23, 'Scorpio', '♏'], [11, 22, 'Sagittarius', '♐'], [12, 22, 'Capricorn', '♑'],
];

export function starSign({ m, d }: Ymd): { name: string; symbol: string } {
  const hit = SIGNS.findLast(([sm, sd]) => m > sm || (m === sm && d >= sd)) ?? SIGNS[11];
  return { name: hit[2], symbol: hit[3] };
}

/** "07:30" or "07:30:15" → seconds after midnight */
export function parseTime(s: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!match) return null;
  const [h, m, sec] = match.slice(1).map((x) => Number(x ?? 0));
  return h < 24 && m < 60 && sec < 60 ? h * 3600 + m * 60 + sec : null;
}

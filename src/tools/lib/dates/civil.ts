/** A calendar date with no time or time zone attached; month is 1–12. */
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

/**
 * What to do when a month has no such day (Jan 31 + 1 month, or a Feb 29
 * anniversary in a common year): use the month's last day, or roll to the 1st of
 * the next month.
 */
export type Overflow = 'clamp' | 'roll';

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (y: number, m: number) => (m === 2 && isLeap(y) ? 29 : MONTH_DAYS[m - 1]);

/**
 * Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's
 * days_from_civil). Pure integer math, so no time zone or DST change can ever
 * shift a date by a day.
 */
export function toDays({ y, m, d }: Ymd): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDays(n: number): Ymd {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d: doy - Math.floor((153 * mp + 2) / 5) + 1 };
}

/** 0 = Sunday … 6 = Saturday, for a day number from toDays */
export const weekdayOfDays = (n: number) => (((n % 7) + 11) % 7);
export const weekday = (date: Ymd) => weekdayOfDays(toDays(date));

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const compare = (a: Ymd, b: Ymd) => toDays(a) - toDays(b);
export const addDays = (date: Ymd, n: number) => fromDays(toDays(date) + n);

export function addMonths(date: Ymd, n: number, overflow: Overflow = 'clamp'): Ymd {
  const total = date.y * 12 + date.m - 1 + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  const last = daysInMonth(y, m);
  if (date.d <= last) return { y, m, d: date.d };
  return overflow === 'clamp' ? { y, m, d: last } : addDays({ y, m, d: last }, 1);
}

export interface Span {
  years: number;
  months: number;
  days: number;
  /** whole months, i.e. years × 12 + months */
  totalMonths: number;
}

/**
 * Calendar span between two dates (order doesn't matter): the most whole months
 * that fit, then the leftover days, so that `from + months + days = to`. Counting
 * from the start date (not stepping back from the end) is how ages work: someone
 * born Jan 31 is 1 month old on Feb 28 or 29.
 */
export function span(a: Ymd, b: Ymd, overflow: Overflow = 'clamp'): Span {
  const [from, to] = compare(a, b) <= 0 ? [a, b] : [b, a];
  const end = toDays(to);
  let k = (to.y - from.y) * 12 + to.m - from.m;
  // the month estimate is off by at most one
  if (toDays(addMonths(from, k, overflow)) > end) k--;
  return { years: Math.floor(k / 12), months: k % 12, days: end - toDays(addMonths(from, k, overflow)), totalMonths: k };
}

export const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const toIso = ({ y, m, d }: Ymd) => `${y < 0 ? '-' : ''}${pad(Math.abs(y), 4)}-${pad(m)}-${pad(d)}`;

/** "2026-02-29" → null; accepts - / or . between parts */
export function parseDate(s: string): Ymd | null {
  const match = /^\s*(\d{4,6})[-/.](\d{1,2})[-/.](\d{1,2})\s*$/.exec(s);
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? { y, m, d } : null;
}

/** today on the device's own calendar */
export function today(now = new Date()): Ymd {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

const LONG = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;
const SHORT = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
const long = new Intl.DateTimeFormat('en-US', LONG);
const short = new Intl.DateTimeFormat('en-US', SHORT);
// en-US drops the sign on years before 1 CE, so those need an explicit "BC"
const longEra = new Intl.DateTimeFormat('en-US', { ...LONG, era: 'short' });
const shortEra = new Intl.DateTimeFormat('en-US', { ...SHORT, era: 'short' });
// built from the day number, so the formatter never sees a local-time offset
const asUtc = (date: Ymd) => new Date(toDays(date) * 86_400_000);

/** "Saturday, March 14, 2026" */
export const formatLong = (date: Ymd) => (date.y < 1 ? longEra : long).format(asUtc(date));
/** "Mar 14, 2026" */
export const formatShort = (date: Ymd) => (date.y < 1 ? shortEra : short).format(asUtc(date));

export const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** "2 years, 3 months, 1 day", leaving out zero parts (but never empty) */
export function describeSpan({ years, months, days }: Pick<Span, 'years' | 'months' | 'days'>): string {
  const parts = [[years, 'year'], [months, 'month'], [days, 'day']] as const;
  const shown = parts.filter(([n]) => n).map(([n, w]) => plural(n, w));
  return shown.length ? shown.join(', ') : '0 days';
}

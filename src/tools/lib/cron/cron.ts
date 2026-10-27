export type FieldName = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'weekday';

export interface FieldSpec {
  name: FieldName;
  label: string;
  min: number;
  max: number;
  names?: string[];
}

export const FIELDS: Record<FieldName, FieldSpec> = {
  second: { name: 'second', label: 'Second', min: 0, max: 59 },
  minute: { name: 'minute', label: 'Minute', min: 0, max: 59 },
  hour: { name: 'hour', label: 'Hour', min: 0, max: 23 },
  day: { name: 'day', label: 'Day of month', min: 1, max: 31 },
  month: { name: 'month', label: 'Month', min: 1, max: 12, names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] },
  // 7 is accepted as a second spelling of Sunday
  weekday: { name: 'weekday', label: 'Day of week', min: 0, max: 7, names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
};

export const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export interface CronSchedule {
  /** the five or six field strings, macros expanded */
  fields: string[];
  hasSeconds: boolean;
  seconds: Set<number>;
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** a field starting with * or ? is unrestricted; when both day fields are restricted, either may match */
  dayStar: boolean;
  weekdayStar: boolean;
}

export type ParseResult = { ok: true; schedule: CronSchedule } | { ok: false; error: string };

class CronError extends Error {}

function value(token: string, spec: FieldSpec): number {
  const upper = token.toUpperCase();
  const named = spec.names?.indexOf(upper) ?? -1;
  if (named >= 0) return named + (spec.name === 'month' ? 1 : 0);
  if (!/^\d+$/.test(token)) throw new CronError(`${spec.label}: "${token}" is not a number${spec.names ? ' or a name like ' + spec.names[0] : ''}.`);
  const n = Number(token);
  if (n < spec.min || n > spec.max) throw new CronError(`${spec.label}: ${n} is out of range (${spec.min}–${spec.max}).`);
  return n;
}

/** Expands one field ("1-5", "0-30/10", "MON,WED") into the set of values it allows */
export function parseField(text: string, spec: FieldSpec): Set<number> {
  const out = new Set<number>();
  if (!text) throw new CronError(`${spec.label} is empty.`);
  for (const part of text.split(',')) {
    const bare = (spec.names ?? []).reduce((t, n) => t.replaceAll(n, ''), part.toUpperCase());
    if (/[LW#]/.test(bare)) {
      throw new CronError(`${spec.label}: "${part}" uses L, W or #, which are Quartz extensions that standard cron doesn't support.`);
    }
    const [range, stepText, extra] = part.split('/');
    if (extra !== undefined) throw new CronError(`${spec.label}: "${part}" has more than one "/".`);
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) throw new CronError(`${spec.label}: the step in "${part}" must be a whole number of 1 or more.`);
      step = Number(stepText);
    }
    let lo: number;
    let hi: number;
    if (range === '*' || range === '?') {
      if (range === '?' && spec.name !== 'day' && spec.name !== 'weekday') throw new CronError(`${spec.label}: "?" only works in the day fields.`);
      [lo, hi] = [spec.min, spec.name === 'weekday' ? 6 : spec.max];
    } else if (range.includes('-')) {
      const [a, b, more] = range.split('-');
      if (more !== undefined || !a || !b) throw new CronError(`${spec.label}: "${part}" is not a valid range.`);
      [lo, hi] = [value(a, spec), value(b, spec)];
      if (lo > hi) throw new CronError(`${spec.label}: the range "${range}" runs backwards.`);
    } else {
      lo = value(range, spec);
      // "5/15" means from 5 to the end, every 15
      hi = stepText !== undefined ? spec.max : lo;
    }
    for (let v = lo; v <= hi; v += step) out.add(spec.name === 'weekday' && v === 7 ? 0 : v);
  }
  return out;
}

export function parseCron(input: string): ParseResult {
  let text = input.trim().replace(/\s+/g, ' ');
  if (!text) return { ok: false, error: 'Enter a cron expression.' };
  if (text.startsWith('@')) {
    const macro = MACROS[text.toLowerCase()];
    if (text.toLowerCase() === '@reboot') return { ok: false, error: '@reboot runs once when the machine starts, so it has no repeating schedule.' };
    if (!macro) return { ok: false, error: `"${text}" isn't a known shortcut. Try @hourly, @daily, @weekly, @monthly or @yearly.` };
    text = macro;
  }
  const fields = text.split(' ');
  if (fields.length < 5 || fields.length > 6) {
    return { ok: false, error: `Expected 5 fields (minute hour day month weekday) or 6 with seconds first, but found ${fields.length}.` };
  }
  const hasSeconds = fields.length === 6;
  const [sec, min, hour, day, month, weekday] = hasSeconds ? fields : ['0', ...fields];
  try {
    return {
      ok: true,
      schedule: {
        fields,
        hasSeconds,
        seconds: parseField(sec, FIELDS.second),
        minutes: parseField(min, FIELDS.minute),
        hours: parseField(hour, FIELDS.hour),
        days: parseField(day, FIELDS.day),
        months: parseField(month, FIELDS.month),
        weekdays: parseField(weekday, FIELDS.weekday),
        dayStar: /^[*?]/.test(day),
        weekdayStar: /^[*?]/.test(weekday),
      },
    };
  } catch (e) {
    if (e instanceof CronError) return { ok: false, error: e.message };
    throw e;
  }
}

function dayMatches(s: CronSchedule, day: number, weekday: number) {
  const d = s.days.has(day);
  const w = s.weekdays.has(weekday);
  if (s.dayStar || s.weekdayStar) return d && w;
  return d || w;
}

// give up on schedules that can't happen (Feb 30) once this many years pass without a match;
// 29 Feb on a given weekday can take up to 28 years to come round
const YEAR_LIMIT = 30;

/**
 * Next matching wall-clock time strictly after `wall`. Wall-clock times are held as
 * Date.UTC(...) numbers so calendar math never trips over time zones or DST.
 */
function nextWall(s: CronSchedule, wall: number): number | null {
  const unit = s.hasSeconds ? 1000 : 60_000;
  let t = Math.floor(wall / unit) * unit + unit;
  const endYear = new Date(t).getUTCFullYear() + YEAR_LIMIT;
  for (;;) {
    const d = new Date(t);
    const [y, mo, day, h, mi, sec] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
    if (y > endYear) return null;
    if (!s.months.has(mo + 1)) t = Date.UTC(y, mo + 1, 1);
    else if (!dayMatches(s, day, d.getUTCDay())) t = Date.UTC(y, mo, day + 1);
    else if (!s.hours.has(h)) t = Date.UTC(y, mo, day, h + 1);
    else if (!s.minutes.has(mi)) t = Date.UTC(y, mo, day, h, mi + 1);
    else if (!s.seconds.has(sec)) t = Date.UTC(y, mo, day, h, mi, sec + 1);
    else return t;
  }
}

/** Wall-clock reading of an instant, in UTC or the runtime's local zone */
function toWall(date: Date, utc: boolean) {
  if (utc) return date.getTime();
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
}

/**
 * The next `count` run times after `from`, evaluating the schedule in UTC or local time.
 * Local times skipped by a daylight-saving jump don't exist on the clock, so they're left out.
 */
export function nextRuns(s: CronSchedule, from: Date, count: number, utc = false): Date[] {
  const runs: Date[] = [];
  let wall: number | null = toWall(from, utc);
  while (runs.length < count && (wall = nextWall(s, wall)) !== null) {
    if (utc) {
      runs.push(new Date(wall));
      continue;
    }
    const w = new Date(wall);
    const local = new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds());
    if (toWall(local, false) === wall) runs.push(local);
  }
  return runs;
}

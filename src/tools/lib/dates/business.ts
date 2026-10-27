import { compare, fromDays, parseDate, toDays, weekdayOfDays, type Ymd } from './civil';

export interface WorkWeek {
  /** weekday numbers that are days off, 0 = Sunday */
  weekend: readonly number[];
  holidays?: readonly Ymd[];
}

export const SAT_SUN = [0, 6] as const;

function workdayTest({ weekend, holidays = [] }: WorkWeek) {
  const off = new Set(holidays.map(toDays));
  return (n: number) => !weekend.includes(weekdayOfDays(n)) && !off.has(n);
}

export interface BusinessCount {
  days: number;
  /** holidays in the range that fell on a workday and were skipped */
  holidaysSkipped: number;
}

/**
 * Workdays from the earlier date up to the later one. Like a plain day count the
 * start date counts and the end date doesn't, unless `includeEnd` is set.
 */
export function countBusinessDays(a: Ymd, b: Ymd, week: WorkWeek, includeEnd = false): BusinessCount {
  const [from, to] = compare(a, b) <= 0 ? [a, b] : [b, a];
  const start = toDays(from);
  const n = toDays(to) - start + (includeEnd ? 1 : 0);
  // whole weeks in one go, then at most 6 leftover days
  const full = Math.floor(n / 7);
  let days = full * (7 - new Set(week.weekend).size);
  for (let i = full * 7; i < n; i++) if (!week.weekend.includes(weekdayOfDays(start + i))) days++;

  let holidaysSkipped = 0;
  for (const h of new Set((week.holidays ?? []).map(toDays))) {
    if (h >= start && h < start + n && !week.weekend.includes(weekdayOfDays(h))) holidaysSkipped++;
  }
  return { days: days - holidaysSkipped, holidaysSkipped };
}

/**
 * Step n workdays forward (or back, for negative n). Adding 1 to a Friday gives
 * Monday; adding 0 returns the date unchanged. Null if every day is a day off.
 */
export function addBusinessDays(date: Ymd, n: number, week: WorkWeek): Ymd | null {
  if (new Set(week.weekend).size >= 7) return null;
  const isWork = workdayTest(week);
  const step = Math.sign(n);
  let day = toDays(date);
  for (let left = Math.abs(n); left > 0; ) {
    day += step;
    if (isWork(day)) left--;
  }
  return fromDays(day);
}

/**
 * Pull every YYYY-MM-DD (or YYYY/MM/DD) date out of free text, so a pasted list
 * like "2026-12-25 Christmas" works. Lines with no valid date are reported back.
 */
export function parseHolidays(text: string): { dates: Ymd[]; invalid: string[] } {
  const seen = new Map<number, Ymd>();
  const invalid: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g) ?? [];
    for (const token of tokens) {
      const date = parseDate(token);
      if (date) seen.set(toDays(date), date);
      else invalid.push(token);
    }
    if (!tokens.length && line.trim()) invalid.push(line.trim());
  }
  return { dates: [...seen.values()], invalid };
}

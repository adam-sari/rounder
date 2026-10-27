import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, daysInMonth, describeSpan, formatLong, fromDays, isLeap, parseDate, span, toDays, toIso, weekday, type Ymd,
} from '@/tools/lib/dates/civil';
import { addBusinessDays, countBusinessDays, parseHolidays, SAT_SUN } from '@/tools/lib/dates/business';

const d = (s: string) => parseDate(s) as Ymd;
const utcDays = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000;

describe('civil days', () => {
  it('matches JavaScript UTC dates', () => {
    for (const s of ['1970-01-01', '2000-02-29', '1900-03-01', '1969-12-31', '2026-10-26', '2400-12-31', '1600-01-01']) {
      expect(toDays(d(s))).toBe(utcDays(s));
    }
  });
  it('round-trips every day across four centuries', () => {
    const start = toDays(d('1800-01-01'));
    for (let n = start; n < start + 146097 * 1.1; n++) expect(toDays(fromDays(n))).toBe(n);
  });
  it('knows leap years and month lengths', () => {
    expect([1900, 2000, 2024, 2026, 2100].map(isLeap)).toEqual([false, true, true, false, false]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
  it('gets weekdays right', () => {
    expect(weekday(d('1970-01-01'))).toBe(4); // Thursday
    expect(weekday(d('2026-10-26'))).toBe(1); // Monday
    expect(weekday(d('1969-07-20'))).toBe(0); // Sunday
    expect(formatLong(d('2000-01-01'))).toBe('Saturday, January 1, 2000');
  });
  it('labels years before 1 CE instead of dropping the sign', () => {
    // year 0 is 1 BC, year -974 is 975 BC (subtracting 3,000 years from 2026)
    expect(formatLong({ y: 0, m: 3, d: 1 })).toBe('Wednesday, March 1, 1 BC');
    expect(formatLong(addMonths(d('2026-01-01'), -3000 * 12))).toBe('Sunday, January 1, 975 BC');
    expect(toIso({ y: -5, m: 1, d: 2 })).toBe('-0005-01-02');
  });
  it('is not shifted by daylight saving changes', () => {
    // US and EU clocks change on these dates; a naive local-time diff gets 23h/25h days
    expect(toDays(d('2026-03-09')) - toDays(d('2026-03-08'))).toBe(1);
    expect(toDays(d('2026-10-26')) - toDays(d('2026-10-25'))).toBe(1);
    expect(toIso(addDays(d('2026-03-07'), 2))).toBe('2026-03-09');
  });
});

describe('parseDate', () => {
  it('accepts real dates with common separators', () => {
    expect(parseDate('2026-12-25')).toEqual({ y: 2026, m: 12, d: 25 });
    expect(parseDate('2026/1/5')).toEqual({ y: 2026, m: 1, d: 5 });
  });
  it('rejects impossible dates', () => {
    expect(parseDate('2026-02-29')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('2026-04-31')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('12/25/2026')).toBeNull();
  });
});

describe('addMonths', () => {
  it('clamps to the end of shorter months', () => {
    expect(toIso(addMonths(d('2026-01-31'), 1))).toBe('2026-02-28');
    expect(toIso(addMonths(d('2024-01-31'), 1))).toBe('2024-02-29');
    expect(toIso(addMonths(d('2026-03-31'), -1))).toBe('2026-02-28');
    expect(toIso(addMonths(d('2026-05-31'), 1))).toBe('2026-06-30');
  });
  it('rolls over to the 1st when asked', () => {
    expect(toIso(addMonths(d('2026-01-31'), 1, 'roll'))).toBe('2026-03-01');
    expect(toIso(addMonths(d('2024-02-29'), 12, 'roll'))).toBe('2025-03-01');
  });
  it('crosses years in both directions', () => {
    expect(toIso(addMonths(d('2026-11-15'), 3))).toBe('2027-02-15');
    expect(toIso(addMonths(d('2026-02-15'), -14))).toBe('2024-12-15');
    expect(toIso(addMonths(d('2024-02-29'), 48))).toBe('2028-02-29');
  });
});

describe('span', () => {
  it('splits into years, months and days', () => {
    expect(span(d('2000-01-15'), d('2026-10-26'))).toMatchObject({ years: 26, months: 9, days: 11, totalMonths: 321 });
    expect(span(d('2026-01-01'), d('2026-01-01'))).toMatchObject({ years: 0, months: 0, days: 0 });
  });
  it('handles month ends the way ages do', () => {
    expect(span(d('2026-01-31'), d('2026-02-28'))).toMatchObject({ months: 1, days: 0 });
    expect(span(d('2026-01-31'), d('2026-03-01'))).toMatchObject({ months: 1, days: 1 });
    expect(span(d('2026-01-31'), d('2026-03-31'))).toMatchObject({ months: 2, days: 0 });
    expect(span(d('2026-01-30'), d('2026-02-27'))).toMatchObject({ months: 0, days: 28 });
  });
  it('is the same whichever date comes first', () => {
    expect(span(d('2026-12-25'), d('2026-01-01'))).toEqual(span(d('2026-01-01'), d('2026-12-25')));
  });
  it('always adds back up to the end date', () => {
    const from = d('2023-01-29');
    for (let i = 0; i < 800; i++) {
      const to = addDays(from, i);
      const s = span(from, to);
      expect(toIso(addDays(addMonths(from, s.totalMonths), s.days))).toBe(toIso(to));
      expect(s.days).toBeLessThan(31);
    }
  });
  it('describes spans in words', () => {
    expect(describeSpan({ years: 1, months: 0, days: 2 })).toBe('1 year, 2 days');
    expect(describeSpan({ years: 0, months: 0, days: 0 })).toBe('0 days');
  });
});

describe('business days', () => {
  const week = { weekend: SAT_SUN };
  it('counts weekdays, start inclusive and end exclusive', () => {
    // Mon Oct 26 → Mon Nov 2, 2026
    expect(countBusinessDays(d('2026-10-26'), d('2026-11-02'), week).days).toBe(5);
    expect(countBusinessDays(d('2026-10-26'), d('2026-10-30'), week).days).toBe(4);
    expect(countBusinessDays(d('2026-10-26'), d('2026-10-30'), week, true).days).toBe(5);
    expect(countBusinessDays(d('2026-10-31'), d('2026-11-01'), week, true).days).toBe(0);
  });
  it('matches a day-by-day count over long ranges', () => {
    const from = d('2026-01-01');
    for (const len of [0, 1, 6, 7, 13, 100, 365, 1000]) {
      const to = addDays(from, len);
      let slow = 0;
      for (let i = 0; i < len; i++) if (![0, 6].includes(weekday(addDays(from, i)))) slow++;
      expect(countBusinessDays(from, to, week).days).toBe(slow);
    }
  });
  it('skips holidays on workdays only, once each', () => {
    const holidays = [d('2026-12-25'), d('2026-12-26'), d('2026-12-25'), d('2027-01-01')];
    const r = countBusinessDays(d('2026-12-21'), d('2027-01-04'), { weekend: SAT_SUN, holidays });
    // 10 weekdays, minus Christmas (Fri) and New Year (Fri); Dec 26 is a Saturday
    expect(r).toEqual({ days: 8, holidaysSkipped: 2 });
  });
  it('supports other weekends', () => {
    // Friday–Saturday weekend
    expect(countBusinessDays(d('2026-10-25'), d('2026-11-01'), { weekend: [5, 6] }).days).toBe(5);
  });
  it('adds and subtracts workdays', () => {
    expect(toIso(addBusinessDays(d('2026-10-30'), 1, week)!)).toBe('2026-11-02'); // Fri → Mon
    expect(toIso(addBusinessDays(d('2026-11-02'), -1, week)!)).toBe('2026-10-30');
    expect(toIso(addBusinessDays(d('2026-10-26'), 10, week)!)).toBe('2026-11-09');
    expect(toIso(addBusinessDays(d('2026-10-31'), 0, week)!)).toBe('2026-10-31');
    const holidays = [d('2026-12-25')];
    expect(toIso(addBusinessDays(d('2026-12-24'), 1, { weekend: SAT_SUN, holidays })!)).toBe('2026-12-28');
    expect(addBusinessDays(d('2026-10-26'), 3, { weekend: [0, 1, 2, 3, 4, 5, 6] })).toBeNull();
  });
  it('round-trips with the count', () => {
    const from = d('2026-03-04');
    for (const n of [1, 5, 9, 22, 260]) {
      const to = addBusinessDays(from, n, week)!;
      expect(countBusinessDays(from, to, week).days).toBe(n);
    }
  });
});

describe('parseHolidays', () => {
  it('finds dates in free text and flags the rest', () => {
    const r = parseHolidays('2026-12-25 Christmas\n2026/12/26, 2027-01-01\n\nnext friday\n2026-02-30');
    expect(r.dates.map(toIso)).toEqual(['2026-12-25', '2026-12-26', '2027-01-01']);
    expect(r.invalid).toEqual(['next friday', '2026-02-30']);
  });
  it('drops duplicates', () => {
    expect(parseHolidays('2026-07-04\n2026-07-04').dates).toHaveLength(1);
  });
});

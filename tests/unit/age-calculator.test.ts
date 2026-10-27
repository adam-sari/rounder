import { describe, expect, it } from 'vitest';
import { parseDate, toDays, toIso, type Ymd } from '@/tools/lib/dates/civil';
import { ageOn, nextBirthday, parseTime, starSign } from '@/tools/lib/dates/age';
import { chineseZodiac, lunarNewYear } from '@/tools/lib/dates/lunar';

const d = (s: string) => parseDate(s) as Ymd;

describe('ageOn', () => {
  it('gives the exact age in years, months and days', () => {
    expect(ageOn(d('1990-05-15'), d('2026-10-26'))).toMatchObject({ years: 36, months: 5, days: 11 });
    expect(ageOn(d('1990-10-26'), d('2026-10-26'))).toMatchObject({ years: 36, months: 0, days: 0 });
    expect(ageOn(d('1990-10-27'), d('2026-10-26'))).toMatchObject({ years: 35, months: 11, days: 29 });
  });
  it('works out the totals', () => {
    const a = ageOn(d('2026-01-01'), d('2026-03-01'))!;
    expect(a).toMatchObject({ totalDays: 59, totalWeeks: 8, totalMonths: 2, totalHours: 59 * 24 });
  });
  it('is null before birth', () => {
    expect(ageOn(d('2026-10-27'), d('2026-10-26'))).toBeNull();
    expect(ageOn(d('2026-10-26'), d('2026-10-26'))).toMatchObject({ years: 0, totalDays: 0 });
  });
  it('uses the birth time when given', () => {
    const born = { birthTime: 14 * 3600 + 30 * 60 };
    // the day after birth, an hour before the birth time: not a full day old yet
    expect(ageOn(d('2026-10-25'), d('2026-10-26'), { ...born, time: 13.5 * 3600 })).toMatchObject({
      days: 0, hours: 23, minutes: 0, totalDays: 0, totalHours: 23,
    });
    expect(ageOn(d('2026-10-25'), d('2026-10-26'), { ...born, time: 15 * 3600 + 5 })).toMatchObject({
      days: 1, hours: 0, minutes: 30, seconds: 5, totalSeconds: 86_400 + 1805,
    });
    expect(ageOn(d('2026-10-26'), d('2026-10-26'), { ...born, time: 3600 })).toBeNull();
    // the birthday itself, before the birth time: still one year short
    expect(ageOn(d('2000-10-26'), d('2026-10-26'), { ...born, time: 3600 })).toMatchObject({ years: 25, months: 11, days: 29, hours: 10, minutes: 30 });
  });
  it('handles leap-day birthdays both ways', () => {
    const leapling = d('2004-02-29');
    expect(ageOn(leapling, d('2026-02-28'))).toMatchObject({ years: 22, months: 0, days: 0 });
    expect(ageOn(leapling, d('2026-02-28'), { leap: 'roll' })).toMatchObject({ years: 21, months: 11, days: 30 });
    expect(ageOn(leapling, d('2026-03-01'), { leap: 'roll' })).toMatchObject({ years: 22, months: 0, days: 0 });
    expect(ageOn(leapling, d('2028-02-29'))).toMatchObject({ years: 24, months: 0, days: 0 });
    expect(ageOn(leapling, d('2026-03-29'))).toMatchObject({ years: 22, months: 1, days: 0 });
  });
  it('handles month-end birthdays', () => {
    expect(ageOn(d('2000-01-31'), d('2026-02-28'))).toMatchObject({ years: 26, months: 1, days: 0 });
    expect(ageOn(d('2000-01-31'), d('2026-03-01'))).toMatchObject({ years: 26, months: 1, days: 1 });
  });
});

describe('nextBirthday', () => {
  it('counts down to the next one', () => {
    expect(nextBirthday(d('1990-12-25'), d('2026-10-26'))).toMatchObject({ turning: 36, inDays: 60 });
    const b = nextBirthday(d('1990-01-10'), d('2026-10-26'));
    expect(toIso(b.date)).toBe('2027-01-10');
    expect(b.turning).toBe(37);
  });
  it('is today on the birthday', () => {
    expect(nextBirthday(d('1990-10-26'), d('2026-10-26'))).toMatchObject({ turning: 36, inDays: 0 });
  });
  it('is next year for a newborn', () => {
    expect(nextBirthday(d('2026-10-26'), d('2026-10-26'))).toMatchObject({ turning: 1, inDays: 365 });
  });
  it('puts leap-day birthdays on Feb 28 or Mar 1 in common years', () => {
    expect(toIso(nextBirthday(d('2004-02-29'), d('2026-10-26')).date)).toBe('2027-02-28');
    expect(toIso(nextBirthday(d('2004-02-29'), d('2026-10-26'), 'roll').date)).toBe('2027-03-01');
    expect(toIso(nextBirthday(d('2004-02-29'), d('2027-03-02')).date)).toBe('2028-02-29');
    expect(nextBirthday(d('2004-02-29'), d('2027-02-28'))).toMatchObject({ turning: 23, inDays: 0 });
  });
});

describe('starSign', () => {
  it('uses the usual date ranges', () => {
    expect(starSign(d('2000-01-01')).name).toBe('Capricorn');
    expect(starSign(d('2000-01-20')).name).toBe('Aquarius');
    expect(starSign(d('2000-03-20')).name).toBe('Pisces');
    expect(starSign(d('2000-03-21')).name).toBe('Aries');
    expect(starSign(d('2000-07-23')).name).toBe('Leo');
    expect(starSign(d('2000-12-21')).name).toBe('Sagittarius');
    expect(starSign(d('2000-12-31')).name).toBe('Capricorn');
  });
});

describe('Chinese zodiac', () => {
  it('finds Lunar New Year', () => {
    const known = [
      '1985-02-20', '1990-01-27', '1996-02-19', '2000-02-05', '2001-01-24', '2002-02-12', '2003-02-01', '2004-01-22',
      '2005-02-09', '2006-01-29', '2007-02-18', '2008-02-07', '2009-01-26', '2010-02-14', '2011-02-03', '2012-01-23',
      '2013-02-10', '2014-01-31', '2015-02-19', '2016-02-08', '2017-01-28', '2018-02-16', '2019-02-05', '2020-01-25',
      '2021-02-12', '2022-02-01', '2023-01-22', '2024-02-10', '2025-01-29', '2026-02-17', '2034-02-19',
    ];
    for (const s of known) expect(toIso(lunarNewYear(+s.slice(0, 4)))).toBe(s);
  });
  it('stays in its window with 12- or 13-month years from 1900 to 2100', () => {
    let prev = toDays(lunarNewYear(1900));
    for (let y = 1901; y <= 2100; y++) {
      const ny = lunarNewYear(y);
      expect(ny.m === 1 ? ny.d >= 21 : ny.m === 2 && ny.d <= 21).toBe(true);
      const gap = toDays(ny) - prev;
      expect((gap >= 353 && gap <= 356) || (gap >= 383 && gap <= 385)).toBe(true);
      prev = toDays(ny);
    }
  });
  it('names the animal and element', () => {
    expect(chineseZodiac(d('2024-06-01'))).toMatchObject({ animal: 'Dragon', element: 'Wood' });
    expect(chineseZodiac(d('2020-03-01'))).toMatchObject({ animal: 'Rat', element: 'Metal' });
    expect(chineseZodiac(d('1990-08-01'))).toMatchObject({ animal: 'Horse', element: 'Metal' });
  });
  it('gives early-year birthdays the previous year\'s sign', () => {
    const c = chineseZodiac(d('2024-02-09'));
    expect(c).toMatchObject({ animal: 'Rabbit', element: 'Water' });
    expect(toIso(c.yearStart)).toBe('2023-01-22');
    expect(chineseZodiac(d('2024-02-10')).animal).toBe('Dragon');
  });
});

describe('parseTime', () => {
  it('reads hh:mm and hh:mm:ss', () => {
    expect(parseTime('07:30')).toBe(27000);
    expect(parseTime('23:59:59')).toBe(86399);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

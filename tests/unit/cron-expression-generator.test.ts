import { describe, expect, it } from 'vitest';
import { nextRuns, parseCron, type CronSchedule } from '@/tools/lib/cron/cron';
import { compose, composeField, decompose, decomposeField, withMode } from '@/tools/lib/cron/builder';
import { FIELDS } from '@/tools/lib/cron/cron';

function schedule(expr: string): CronSchedule {
  const r = parseCron(expr);
  if (!r.ok) throw new Error(r.error);
  return r.schedule;
}

const utcRuns = (expr: string, from: string, count = 5) =>
  nextRuns(schedule(expr), new Date(from), count, true).map((d) => d.toISOString());

describe('parseCron', () => {
  it('expands lists, ranges, steps and names', () => {
    const s = schedule('*/15 9-17 1,15 JAN-MAR mon-fri');
    expect([...s.minutes]).toEqual([0, 15, 30, 45]);
    expect([...s.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...s.days]).toEqual([1, 15]);
    expect([...s.months]).toEqual([1, 2, 3]);
    expect([...s.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect(s.hasSeconds).toBe(false);
  });

  it('treats a start with a step as running to the end of the range', () => {
    expect([...schedule('5/20 * * * *').minutes]).toEqual([5, 25, 45]);
    expect([...schedule('0 0-30/10 * * * *').minutes]).toEqual([0, 10, 20, 30]);
  });

  it('accepts 7 as Sunday', () => {
    expect([...schedule('0 0 * * 7').weekdays]).toEqual([0]);
    expect([...schedule('0 0 * * 5-7').weekdays].sort()).toEqual([0, 5, 6]);
  });

  it('reads a sixth leading field as seconds', () => {
    const s = schedule('30 */5 * * * *');
    expect(s.hasSeconds).toBe(true);
    expect([...s.seconds]).toEqual([30]);
    expect([...s.minutes]).toHaveLength(12);
  });

  it('expands macros', () => {
    expect(schedule('@daily').fields).toEqual(['0', '0', '*', '*', '*']);
    expect(schedule('@HOURLY').fields).toEqual(['0', '*', '*', '*', '*']);
    expect(schedule('@weekly').fields.join(' ')).toBe('0 0 * * 0');
  });

  it('explains what is wrong', () => {
    const err = (expr: string) => {
      const r = parseCron(expr);
      return r.ok ? '' : r.error;
    };
    expect(err('')).toMatch(/Enter/);
    expect(err('* * * *')).toMatch(/found 4/);
    expect(err('60 * * * *')).toMatch(/Minute: 60 is out of range/);
    expect(err('* 24 * * *')).toMatch(/Hour/);
    expect(err('* * 0 * *')).toMatch(/Day of month/);
    expect(err('* * * 13 *')).toMatch(/Month/);
    expect(err('* * * * 8')).toMatch(/Day of week/);
    expect(err('* * * * 5-1')).toMatch(/backwards/);
    expect(err('*/0 * * * *')).toMatch(/step/);
    expect(err('* * L * *')).toMatch(/Quartz/);
    expect(err('* * * * FRI#2')).toMatch(/Quartz/);
    expect(err('@reboot')).toMatch(/startup|starts/);
    expect(err('@sometimes')).toMatch(/known shortcut/);
    expect(err('abc * * * *')).toMatch(/not a number/);
  });

  it('allows names that contain L or W', () => {
    expect(parseCron('0 0 * JUL WED').ok).toBe(true);
  });
});

describe('nextRuns', () => {
  it('steps through every 5 minutes', () => {
    expect(utcRuns('*/5 * * * *', '2026-03-01T10:02:30Z', 3)).toEqual([
      '2026-03-01T10:05:00.000Z', '2026-03-01T10:10:00.000Z', '2026-03-01T10:15:00.000Z',
    ]);
  });

  it('is strictly after the start time', () => {
    expect(utcRuns('0 * * * *', '2026-03-01T10:00:00Z', 1)).toEqual(['2026-03-01T11:00:00.000Z']);
  });

  it('skips weekends for weekday schedules', () => {
    // 2026-03-06 is a Friday
    expect(utcRuns('0 9 * * 1-5', '2026-03-06T10:00:00Z', 2)).toEqual([
      '2026-03-09T09:00:00.000Z', '2026-03-10T09:00:00.000Z',
    ]);
  });

  it('rolls over months and years', () => {
    expect(utcRuns('0 0 1 * *', '2026-12-15T00:00:00Z', 2)).toEqual([
      '2027-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z',
    ]);
  });

  it('only uses the 31st in months that have one', () => {
    expect(utcRuns('0 12 31 * *', '2026-01-31T13:00:00Z', 3)).toEqual([
      '2026-03-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z', '2026-07-31T12:00:00.000Z',
    ]);
  });

  it('finds leap days', () => {
    expect(utcRuns('0 0 29 2 *', '2026-01-01T00:00:00Z', 2)).toEqual([
      '2028-02-29T00:00:00.000Z', '2032-02-29T00:00:00.000Z',
    ]);
  });

  it('matches either day field when both are restricted', () => {
    // the 13th, or any Friday: 2026-03-06 (Fri), 2026-03-13 (Fri and 13th), 2026-03-20 (Fri)
    expect(utcRuns('0 0 13 * 5', '2026-03-01T00:00:00Z', 3)).toEqual([
      '2026-03-06T00:00:00.000Z', '2026-03-13T00:00:00.000Z', '2026-03-20T00:00:00.000Z',
    ]);
  });

  it('treats a starred step as unrestricted for the day rule', () => {
    // */2 in day-of-month still ANDs with Monday
    const runs = utcRuns('0 0 */2 * 1', '2026-03-01T00:00:00Z', 3);
    for (const r of runs) {
      const d = new Date(r);
      expect(d.getUTCDay()).toBe(1);
      expect(d.getUTCDate() % 2).toBe(1);
    }
  });

  it('handles seconds', () => {
    expect(utcRuns('*/20 * * * * *', '2026-03-01T10:00:05Z', 3)).toEqual([
      '2026-03-01T10:00:20.000Z', '2026-03-01T10:00:40.000Z', '2026-03-01T10:01:00.000Z',
    ]);
  });

  it('returns nothing for dates that never happen', () => {
    expect(utcRuns('0 0 30 2 *', '2026-01-01T00:00:00Z')).toEqual([]);
  });

  it('runs at the local wall-clock time in local mode', () => {
    const runs = nextRuns(schedule('30 14 * * *'), new Date(2026, 5, 1, 15, 0), 2, false);
    expect(runs.map((d) => [d.getDate(), d.getHours(), d.getMinutes()])).toEqual([[2, 14, 30], [3, 14, 30]]);
  });
});

describe('builder', () => {
  it('reads simple fields into modes', () => {
    expect(decomposeField('*', FIELDS.minute).mode).toBe('every');
    expect(decomposeField('5,10', FIELDS.minute)).toMatchObject({ mode: 'specific', values: [5, 10] });
    expect(decomposeField('MON-FRI', FIELDS.weekday)).toMatchObject({ mode: 'range', from: 1, to: 5 });
    expect(decomposeField('*/15', FIELDS.minute)).toMatchObject({ mode: 'step', every: 15, start: 0 });
    expect(decomposeField('10/15', FIELDS.minute)).toMatchObject({ mode: 'step', every: 15, start: 10 });
    expect(decomposeField('1-5,10', FIELDS.minute)).toMatchObject({ mode: 'custom', raw: '1-5,10' });
    expect(decomposeField('99', FIELDS.minute).mode).toBe('custom');
  });

  it('writes fields back, joining runs into ranges', () => {
    const f = FIELDS.weekday;
    expect(composeField({ ...decomposeField('*', f), mode: 'specific', values: [5, 1, 2, 3, 4] }, f)).toBe('1-5');
    expect(composeField({ ...decomposeField('*', f), mode: 'specific', values: [0, 6] }, f)).toBe('0,6');
    expect(composeField({ ...decomposeField('*', FIELDS.minute), mode: 'specific', values: [0, 1, 2, 30] }, FIELDS.minute)).toBe('0-2,30');
    expect(composeField({ ...decomposeField('*', FIELDS.minute), mode: 'step', every: 10, start: 5 }, FIELDS.minute)).toBe('5/10');
  });

  it('round-trips whole expressions', () => {
    for (const expr of ['*/5 * * * *', '0 9 * * 1-5', '0 0 1 * *', '15 10 * 1,4,7,10 *', '0 */15 9-17 * * 1-5']) {
      const fields = expr.split(' ');
      expect(compose(decompose(fields), fields.length === 6)).toBe(expr);
    }
  });

  it('wraps backwards ranges instead of flipping them', () => {
    expect(composeField(decomposeField('5-7', FIELDS.weekday), FIELDS.weekday)).toBe('5-7');
    expect(composeField({ ...decomposeField('*', FIELDS.weekday), mode: 'range', from: 5, to: 2 }, FIELDS.weekday)).toBe('5-6,0-2');
    expect(composeField({ ...decomposeField('*', FIELDS.hour), mode: 'range', from: 22, to: 6 }, FIELDS.hour)).toBe('22-23,0-6');
    expect(composeField({ ...decomposeField('*', FIELDS.hour), mode: 'range', from: 23, to: 0 }, FIELDS.hour)).toBe('23,0');
    expect(decomposeField('0-7', FIELDS.weekday).mode).toBe('custom');
  });

  it('keeps custom fields free of spaces', () => {
    expect(composeField({ ...decomposeField('*', FIELDS.minute), mode: 'custom', raw: ' 1, 5 ' }, FIELDS.minute)).toBe('1,5');
  });

  it('seeds a sensible value when switching mode', () => {
    const every = decomposeField('*', FIELDS.minute);
    expect(composeField(withMode(every, 'specific', FIELDS.minute), FIELDS.minute)).toBe('0');
    expect(composeField(withMode(every, 'step', FIELDS.minute), FIELDS.minute)).toBe('*/15');
    expect(composeField(withMode(decomposeField('*', FIELDS.hour), 'range', FIELDS.hour), FIELDS.hour)).toBe('9-17');
    expect(composeField(withMode(decomposeField('*', FIELDS.month), 'range', FIELDS.month), FIELDS.month)).toBe('1-12');
  });
});

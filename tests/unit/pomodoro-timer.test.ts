import { describe, expect, it } from 'vitest';
import { addToTally, advance, todays } from '@/tools/lib/timers/pomodoro';

describe('pomodoro', () => {
  it('goes focus → short break until the long one', () => {
    expect(advance('work', 0, 4)).toEqual({ phase: 'short', done: 1 });
    expect(advance('short', 1, 4)).toEqual({ phase: 'work', done: 1 });
    expect(advance('work', 3, 4)).toEqual({ phase: 'long', done: 4 });
    expect(advance('long', 4, 4)).toEqual({ phase: 'work', done: 0 });
  });
  it('handles a long break after every session', () => {
    expect(advance('work', 0, 1)).toEqual({ phase: 'long', done: 1 });
    expect(advance('work', 0, 0)).toEqual({ phase: 'long', done: 1 });
  });
  it("keeps today's tally and starts fresh on a new day", () => {
    let t = addToTally(null, '2026-10-26', 25);
    t = addToTally(t, '2026-10-26', 25);
    expect(t).toEqual({ day: '2026-10-26', sessions: 2, minutes: 50 });
    expect(addToTally(t, '2026-10-27', 30)).toEqual({ day: '2026-10-27', sessions: 1, minutes: 30 });
    expect(todays(t, '2026-10-27')).toEqual({ day: '2026-10-27', sessions: 0, minutes: 0 });
    expect(todays(t, '2026-10-26')).toBe(t);
  });
});

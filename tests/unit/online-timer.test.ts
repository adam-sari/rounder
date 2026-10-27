import { describe, expect, it } from 'vitest';
import { dayKey, elapsed, formatClock, formatCountdown, formatHuman, idle, isRunning, pause, split, start, toMs, wholeOr0 } from '@/tools/lib/timers/clock';

describe('clock', () => {
  it('counts from timestamps across pauses', () => {
    let c = start(idle(), 1000);
    expect(isRunning(c)).toBe(true);
    expect(elapsed(c, 4000)).toBe(3000);
    c = pause(c, 4000);
    expect(isRunning(c)).toBe(false);
    expect(elapsed(c, 99_000)).toBe(3000);
    c = start(c, 10_000);
    expect(elapsed(c, 12_500)).toBe(5500);
  });
  it('ignores repeated start and pause', () => {
    const c = start(idle(), 1000);
    expect(start(c, 5000)).toBe(c);
    const p = pause(c, 2000);
    expect(pause(p, 9000)).toBe(p);
  });
  it('never goes negative if the clock steps back', () => {
    expect(elapsed(start(idle(), 5000), 4000)).toBe(0);
  });
});

describe('formatting', () => {
  it('splits a duration', () => {
    expect(split(3_723_456)).toEqual({ h: 1, m: 2, s: 3, cs: 45 });
    expect(split(-50)).toEqual({ h: 0, m: 0, s: 0, cs: 0 });
  });
  it('formats clocks', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(83_456)).toBe('01:23');
    expect(formatClock(83_456, { centis: true })).toBe('01:23.45');
    expect(formatClock(3_723_000)).toBe('1:02:03');
    expect(formatClock(36_000_000 * 3)).toBe('30:00:00');
  });
  it('rounds countdowns up to the next whole second', () => {
    expect(formatCountdown(300_000)).toBe('05:00');
    expect(formatCountdown(299_001)).toBe('05:00');
    expect(formatCountdown(299_000)).toBe('04:59');
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(-4000)).toBe('00:00');
  });
  it('writes durations for people', () => {
    expect(formatHuman(90_000)).toBe('1 min 30 s');
    expect(formatHuman(5_400_000)).toBe('1 h 30 min');
    expect(formatHuman(0)).toBe('0 s');
  });
  it('parses h/m/s', () => {
    expect(toMs({ h: 1, m: 2, s: 3 })).toBe(3_723_000);
    expect(toMs({ m: 75 })).toBe(4_500_000);
    expect(wholeOr0(NaN)).toBe(0);
    expect(wholeOr0(null)).toBe(0);
    expect(wholeOr0(-3)).toBe(0);
    expect(wholeOr0(4.7)).toBe(4);
  });
  it('makes a local day key', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

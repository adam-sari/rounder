import { describe, expect, it } from 'vitest';
import { lapStats, lapsCsv } from '@/tools/lib/timers/clock';

describe('laps', () => {
  it('turns splits into laps with fastest and slowest', () => {
    const s = lapStats([10_000, 25_000, 33_000, 45_000]);
    expect(s.laps).toEqual([10_000, 15_000, 8000, 12_000]);
    expect(s.fastest).toBe(2);
    expect(s.slowest).toBe(1);
  });
  it('highlights nothing with a single lap', () => {
    expect(lapStats([5000])).toEqual({ laps: [5000], fastest: -1, slowest: -1 });
    expect(lapStats([])).toEqual({ laps: [], fastest: -1, slowest: -1 });
  });
  it('highlights nothing when every lap is the same length', () => {
    expect(lapStats([5000, 10_000, 15_000])).toEqual({ laps: [5000, 5000, 5000], fastest: -1, slowest: -1 });
  });
  it('exports CSV', () => {
    expect(lapsCsv([12_340, 30_000])).toBe('Lap,Lap time,Total time\r\n1,00:12.34,00:12.34\r\n2,00:17.66,00:30.00\r\n');
  });
});

import { describe, expect, it } from 'vitest';
import {
  clampBpm, defaultAccents, parseSignature, soundFor, subdivisionName, tapTempo, tempoName, TickPlanner, trainerBpm,
  type Level, type Pattern,
} from '@/tools/lib/metronome/rhythm';

const fixed = (bpm: number, accents: Level[], subs = 1) => (): Pattern => ({ bpm, accents, subs });

describe('meters and accents', () => {
  it('parses signatures', () => {
    expect(parseSignature('6/8')).toEqual({ beats: 6, unit: 8 });
  });
  it('accents the first beat, and groups compound meters', () => {
    expect(defaultAccents({ beats: 4, unit: 4 })).toEqual([3, 1, 1, 1]);
    expect(defaultAccents({ beats: 4, unit: 4 }, false)).toEqual([1, 1, 1, 1]);
    expect(defaultAccents({ beats: 6, unit: 8 })).toEqual([3, 1, 1, 2, 1, 1]);
    expect(defaultAccents({ beats: 7, unit: 8 })).toEqual([3, 1, 2, 1, 2, 1, 1]);
    expect(defaultAccents({ beats: 12, unit: 8 })).toEqual([3, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1]);
    expect(defaultAccents({ beats: 3, unit: 8 })).toEqual([3, 1, 1]);
  });
  it('names subdivisions for the beat unit', () => {
    expect(subdivisionName(4, 1)).toBe('off');
    expect(subdivisionName(4, 2)).toBe('8ths');
    expect(subdivisionName(4, 3)).toBe('triplets');
    expect(subdivisionName(4, 4)).toBe('16ths');
    expect(subdivisionName(8, 2)).toBe('16ths');
    expect(subdivisionName(2, 2)).toBe('quarters');
    expect(subdivisionName(8, 4)).toBe('32nds');
    expect(subdivisionName(16, 4)).toBe('64ths');
  });
  it('picks sounds by level', () => {
    const acc: Level[] = [3, 0, 2, 1];
    expect(soundFor({ bar: 0, beat: 0, sub: 0 }, acc)).toBe('accent');
    expect(soundFor({ bar: 0, beat: 1, sub: 0 }, acc)).toBeNull();
    expect(soundFor({ bar: 0, beat: 2, sub: 0 }, acc)).toBe('medium');
    expect(soundFor({ bar: 0, beat: 3, sub: 0 }, acc)).toBe('beat');
    expect(soundFor({ bar: 0, beat: 1, sub: 1 }, acc)).toBe('sub');
  });
});

describe('tempo', () => {
  it('clamps BPM to 20–300', () => {
    expect(clampBpm(10)).toBe(20);
    expect(clampBpm(301)).toBe(300);
    expect(clampBpm(119.6)).toBe(120);
    expect(clampBpm(Number.NaN)).toBe(120);
  });
  it('taps a tempo', () => {
    expect(tapTempo([0])).toBeNull();
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 480, 1010, 1500])).toBe(120);
    // only the last few taps count, so a slow start is forgotten
    expect(tapTempo([0, 1000, 2000, 2500, 3000, 3500, 4000, 4500, 5000])).toBe(120);
  });
  it('names tempos', () => {
    expect(tempoName(30)).toBe('Grave');
    expect(tempoName(100)).toBe('Andante');
    expect(tempoName(120)).toBe('Allegro');
    expect(tempoName(250)).toBe('Prestissimo');
  });
  it('climbs with the trainer and stops at the target', () => {
    const t = { on: true, step: 5, every: 4, target: 110 };
    expect(trainerBpm(100, 0, t)).toBe(100);
    expect(trainerBpm(100, 3, t)).toBe(100);
    expect(trainerBpm(100, 4, t)).toBe(105);
    expect(trainerBpm(100, 8, t)).toBe(110);
    expect(trainerBpm(100, 40, t)).toBe(110);
    expect(trainerBpm(100, 40, { ...t, on: false })).toBe(100);
    // bars before the trainer was switched on hold the start tempo
    expect(trainerBpm(100, -1, t)).toBe(100);
    expect(trainerBpm(100, -9, t)).toBe(100);
    expect(trainerBpm(120, 40, t)).toBe(120);
  });
});

describe('tick planner', () => {
  it('lays out a bar of 4/4 at 120 BPM on exact times', () => {
    const p = new TickPlanner(1);
    const ticks = p.plan(3, fixed(120, [3, 1, 1, 1]));
    expect(ticks.map((t) => t.time)).toEqual([1, 1.5, 2, 2.5]);
    expect(ticks.map((t) => t.sound)).toEqual(['accent', 'beat', 'beat', 'beat']);
    expect(p.pos).toEqual({ bar: 1, beat: 0, sub: 0 });
  });
  it('only plans up to the lookahead, and carries on where it left off', () => {
    const p = new TickPlanner(0);
    expect(p.plan(0.12, fixed(120, [3, 1, 1]))).toHaveLength(1);
    expect(p.plan(0.12, fixed(120, [3, 1, 1]))).toHaveLength(0);
    const next = p.plan(0.62, fixed(120, [3, 1, 1]));
    expect(next.map((t) => [t.beat, t.time])).toEqual([[1, 0.5]]);
  });
  it('subdivides into triplets', () => {
    const ticks = new TickPlanner(0).plan(1, fixed(60, [3, 1], 3));
    expect(ticks.map((t) => t.sound)).toEqual(['accent', 'sub', 'sub']);
    expect(ticks[1].time).toBeCloseTo(1 / 3, 12);
  });
  it('does not drift over a long run', () => {
    const p = new TickPlanner(0);
    const ticks = p.plan(600, fixed(137, [3, 1, 1, 1], 4));
    const last = ticks.at(-1)!;
    const n = ticks.length - 1;
    expect(last.time).toBeCloseTo((n * 60) / 137 / 4, 6);
  });
  it('applies a tempo change on the next tick', () => {
    const p = new TickPlanner(0);
    let bpm = 60;
    const pattern = (): Pattern => ({ bpm, accents: [3, 1, 1, 1], subs: 1 });
    p.plan(0.5, pattern);
    bpm = 120;
    expect(p.plan(2.1, pattern).map((t) => t.time)).toEqual([1, 1.5, 2]);
  });
  it('wraps into a new bar when the meter shrinks mid-bar', () => {
    const p = new TickPlanner(0);
    p.plan(2.5, fixed(60, [3, 1, 1, 1]));
    expect(p.pos.beat).toBe(3);
    const [t] = p.plan(3.5, fixed(60, [3, 1]));
    expect([t.bar, t.beat, t.sound]).toEqual([1, 0, 'accent']);
  });
  it('moves to the next beat when subdivisions are reduced mid-beat', () => {
    const p = new TickPlanner(0);
    p.plan(0.6, fixed(60, [3, 1], 4));
    expect(p.pos).toEqual({ bar: 0, beat: 0, sub: 3 });
    const [t] = p.plan(1, fixed(60, [3, 1], 2));
    expect([t.beat, t.sub]).toEqual([1, 0]);
  });
  it('feeds the bar to the pattern so the trainer can climb', () => {
    const p = new TickPlanner(0);
    const trainer = { on: true, step: 60, every: 1, target: 240 };
    const ticks = p.plan(3, (pos) => ({ bpm: trainerBpm(60, pos.bar, trainer), accents: [3, 1], subs: 1 }));
    expect(ticks.map((t) => t.time)).toEqual([0, 1, 2, 2.5]);
  });
});

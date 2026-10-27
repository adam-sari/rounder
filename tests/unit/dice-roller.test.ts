import { describe, expect, it } from 'vitest';
import { addDie, countDice, diceRange, formatDice, keptMask, parseDice, rollDice } from '@/tools/lib/random/dice';
import type { Rand32 } from '@/tools/lib/random/rng';

/** replays fixed 32-bit values; small values map straight to faces (value % sides + 1) */
const seq = (...values: number[]): Rand32 => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('parseDice', () => {
  it('reads common notation', () => {
    expect(parseDice('2d6+3')).toEqual([
      { type: 'dice', sign: 1, count: 2, sides: 6 },
      { type: 'mod', sign: 1, value: 3 },
    ]);
    expect(parseDice(' D20 - 1 ')).toEqual([
      { type: 'dice', sign: 1, count: 1, sides: 20 },
      { type: 'mod', sign: -1, value: 1 },
    ]);
    expect(parseDice('d%')).toEqual([{ type: 'dice', sign: 1, count: 1, sides: 100 }]);
  });

  it('reads keep and drop', () => {
    expect(parseDice('4d6kh3')[0]).toMatchObject({ keep: { mode: 'kh', n: 3 } });
    expect(parseDice('2d20k1')[0]).toMatchObject({ keep: { mode: 'kh', n: 1 } });
    expect(parseDice('2d20kl1')[0]).toMatchObject({ keep: { mode: 'kl', n: 1 } });
    expect(parseDice('4d6dl1')[0]).toMatchObject({ keep: { mode: 'dl', n: 1 } });
    expect(parseDice('3d6dh0')[0]).not.toHaveProperty('keep');
  });

  it('explains what is wrong', () => {
    expect(() => parseDice('')).toThrow(/Type some dice/);
    expect(() => parseDice('2d6++3')).toThrow(/isn't dice notation/);
    expect(() => parseDice('2d6+')).toThrow(/isn't a die/);
    expect(() => parseDice('hello')).toThrow(/isn't a die/);
    expect(() => parseDice('5')).toThrow(/at least one die/);
    expect(() => parseDice('0d6')).toThrow(/at least one/);
    expect(() => parseDice('d1')).toThrow(/2 to/);
    expect(() => parseDice('2d6kh3')).toThrow(/keep 1 to 2/);
    expect(() => parseDice('2d6dl2')).toThrow(/drop at most 1/);
    expect(() => parseDice('600d6+600d6')).toThrow(/more than/);
  });
});

describe('formatDice and addDie', () => {
  it('writes tidy notation', () => {
    expect(formatDice(parseDice('1d20+2d6-1'))).toBe('d20 + 2d6 - 1');
    expect(formatDice(parseDice('-d4'))).toBe('-d4');
    expect(formatDice(parseDice('4D6KH3'))).toBe('4d6kh3');
  });

  it('merges a new die into a plain term, before modifiers', () => {
    expect(formatDice(addDie(parseDice('d6+2'), 6))).toBe('2d6 + 2');
    expect(formatDice(addDie(parseDice('d20+5'), 4))).toBe('d20 + d4 + 5');
    expect(formatDice(addDie(parseDice('4d6kh3'), 6))).toBe('4d6kh3 + d6');
    expect(formatDice(addDie([], 8))).toBe('d8');
  });

  it('counts dice per size', () => {
    expect(countDice(parseDice('2d6+d20+d6+4'))).toEqual({ 6: 3, 20: 1 });
  });
});

describe('rolling', () => {
  it('keeps the right dice', () => {
    expect(keptMask([3, 6, 1, 6], { mode: 'kh', n: 3 })).toEqual([true, true, false, true]);
    expect(keptMask([3, 6, 1, 6], { mode: 'dl', n: 1 })).toEqual([true, true, false, true]);
    expect(keptMask([3, 6, 1, 6], { mode: 'kl', n: 1 })).toEqual([false, false, true, false]);
    // ties keep the earlier die
    expect(keptMask([5, 5], { mode: 'dh', n: 1 })).toEqual([true, false]);
  });

  it('adds up kept dice and modifiers', () => {
    // faces: 3, 6, 1, 4 then the d20 rolls 20
    const r = rollDice(parseDice('4d6kh3 - d20 + 2'), seq(2, 5, 0, 3, 19));
    expect(r.terms[0].dice.map((d) => d.value)).toEqual([3, 6, 1, 4]);
    expect(r.terms[0].subtotal).toBe(13);
    expect(r.terms[1].subtotal).toBe(-20);
    expect(r.total).toBe(-5);
    expect(r.notation).toBe('4d6kh3 - d20 + 2');
  });

  it('rejects terms run together by a space, and reads typographic minus', () => {
    expect(() => parseDice('2d6 3')).toThrow(/between terms/);
    expect(formatDice(parseDice('d20 − 1'))).toBe('d20 - 1');
    expect(formatDice(parseDice(' d20 + d4 - 1 '))).toBe('d20 + d4 - 1');
  });

  it('stays within the possible range', () => {
    const terms = parseDice('3d8dl1 - d4 + 1');
    const { min, max } = diceRange(terms);
    expect([min, max]).toEqual([-1, 16]);
    for (let i = 0; i < 500; i++) {
      const { total } = rollDice(terms);
      expect(total).toBeGreaterThanOrEqual(min);
      expect(total).toBeLessThanOrEqual(max);
    }
  });
});

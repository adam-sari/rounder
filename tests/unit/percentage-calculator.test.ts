import { describe, expect, it } from 'vitest';
import { applyPercent, fmt, parseNum, percentChange, percentOf, reversePercent, whatPercent } from '@/tools/lib/percentage/calc';

describe('parseNum', () => {
  it('reads everyday number formats', () => {
    expect(parseNum('1,250.5')).toBe(1250.5);
    expect(parseNum(' 20 % ')).toBe(20);
    expect(parseNum('$99.99')).toBe(99.99);
    expect(parseNum('-.5')).toBe(-0.5);
    expect(parseNum('1e3')).toBe(1000);
    expect(parseNum('−12.5')).toBe(-12.5); // U+2212 minus sign
  });
  it('rejects junk', () => {
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
    expect(parseNum('1.2.3')).toBeNull();
    expect(parseNum('-')).toBeNull();
  });
});

describe('fmt', () => {
  it('hides floating point noise', () => {
    expect(fmt(0.1 + 0.2)).toBe('0.3');
    expect(fmt(percentOf(20, 150))).toBe('30');
    expect(fmt(1234567.891)).toBe('1,234,567.891');
    expect(fmt(2 / 3)).toBe('0.666667');
    expect(fmt(-0)).toBe('0');
    expect(fmt(0.000012345)).toBe('0.00001235');
    expect(fmt(Infinity)).toBe('–');
  });
});

describe('percent math', () => {
  it('works out p% of y', () => {
    expect(percentOf(15, 80)).toBeCloseTo(12);
    expect(percentOf(250, 4)).toBeCloseTo(10);
  });
  it('works out what percent x is of y', () => {
    expect(whatPercent(30, 120)).toBeCloseTo(25);
    expect(whatPercent(5, 0)).toBeNull();
  });
  it('measures change against the starting value', () => {
    expect(percentChange(80, 100)).toBeCloseTo(25);
    expect(percentChange(100, 80)).toBeCloseTo(-20);
    expect(percentChange(-50, -25)).toBeCloseTo(50);
    expect(percentChange(0, 10)).toBeNull();
  });
  it('raises and lowers by a percentage', () => {
    expect(applyPercent(200, 15, 1)).toBeCloseTo(230);
    expect(applyPercent(200, 15, -1)).toBeCloseTo(170);
  });
  it('reverses a percentage, which is not the same as taking it off', () => {
    expect(reversePercent(120, 20, 1)).toBeCloseTo(100);
    expect(applyPercent(120, 20, -1)).toBeCloseTo(96);
    expect(reversePercent(75, 25, -1)).toBeCloseTo(100);
    expect(reversePercent(50, 100, -1)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { bmi, classify, healthyRange, toCm, toFeetInches, toKg, toLb } from '@/tools/lib/bmi/bmi';

describe('bmi', () => {
  it('divides weight by height squared', () => {
    expect(bmi(70, 175)).toBeCloseTo(22.857, 3);
    expect(bmi(0, 175)).toBeNull();
    expect(bmi(70, 0)).toBeNull();
  });

  it('works from imperial units', () => {
    // 5 ft 9 in, 160 lb is a BMI of about 23.6
    expect(bmi(toKg(160), toCm(5, 9))).toBeCloseTo(23.6, 1);
  });
});

describe('classify', () => {
  it('uses the WHO adult cut-offs', () => {
    expect(classify(17).id).toBe('under');
    expect(classify(18.5).id).toBe('healthy');
    expect(classify(24.9).id).toBe('healthy');
    expect(classify(25).id).toBe('over');
    expect(classify(30).id).toBe('obese1');
    expect(classify(35).id).toBe('obese2');
    expect(classify(40).id).toBe('obese3');
  });

  it('agrees with the rounded number on screen', () => {
    expect(classify(24.96).id).toBe('over');
    expect(classify(18.46).id).toBe('healthy');
    expect(classify(18.44).id).toBe('under');
  });
});

describe('healthyRange', () => {
  it('spans BMI 18.5 to 24.9 for the height', () => {
    const [lo, hi] = healthyRange(180)!;
    expect(lo).toBeCloseTo(59.94, 2);
    expect(hi).toBeCloseTo(80.676, 2);
  });
});

describe('unit conversion', () => {
  it('round-trips feet and inches', () => {
    expect(toFeetInches(toCm(5, 11))).toEqual({ feet: 5, inches: 11 });
    expect(toFeetInches(182.88)).toEqual({ feet: 6, inches: 0 });
    expect(toLb(toKg(150))).toBeCloseTo(150, 9);
  });
});

import { describe, expect, it } from 'vitest';
import { amortize, byYear, escrowPerPayment, levelPayment, paymentDate, periodCount, pmiPlan, scheduleCsv } from '@/tools/lib/loan/amortize';
import { guessCurrency } from '@/tools/lib/loan/currency';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('levelPayment', () => {
  it('matches the standard mortgage formula', () => {
    // $200,000 at 6% over 30 years: $1,199.10 a month
    expect(levelPayment(200_000, 0.06 / 12, 360)).toBeCloseTo(1199.1, 2);
  });

  it('splits evenly at 0% interest', () => {
    expect(levelPayment(1200, 0, 12)).toBe(100);
  });
});

describe('periodCount', () => {
  it('converts a term to payments', () => {
    expect(periodCount(360, 'monthly')).toBe(360);
    expect(periodCount(360, 'biweekly')).toBe(780);
    expect(periodCount(60, 'weekly')).toBe(260);
  });
});

describe('paymentDate', () => {
  it('keeps the day of month and clamps short months', () => {
    expect(paymentDate('2026-01-31', 1, 'monthly')).toBe('2026-02-28');
    expect(paymentDate('2026-01-31', 2, 'monthly')).toBe('2026-03-31');
    expect(paymentDate('2026-11-15', 2, 'monthly')).toBe('2027-01-15');
  });

  it('steps biweekly and weekly by days', () => {
    expect(paymentDate('2026-12-25', 1, 'biweekly')).toBe('2027-01-08');
    expect(paymentDate('2026-03-01', 1, 'weekly')).toBe('2026-03-08');
  });
});

describe('amortize', () => {
  const base = { principal: 200_000, rate: 6, termMonths: 360, frequency: 'monthly' as const, start: '2027-01-01' };

  it('pays the loan off in exactly the term', () => {
    const s = amortize(base);
    expect(s.payment).toBe(1199.1);
    expect(s.rows).toHaveLength(360);
    expect(s.rows.at(-1)!.balance).toBe(0);
    expect(s.rows.at(-1)!.date).toBe('2056-12-01');
    expect(sum(s.rows.map((r) => r.principal))).toBeCloseTo(200_000, 2);
    // 360 × 1199.10 − 200,000, give or take the final payment's rounding
    expect(s.totalInterest).toBeGreaterThan(231_670);
    expect(s.totalInterest).toBeLessThan(231_680);
  });

  it('splits the first payment into interest and principal', () => {
    const [first] = amortize(base).rows;
    expect(first.interest).toBe(1000);
    expect(first.principal).toBe(199.1);
    expect(first.balance).toBe(199_800.9);
  });

  it('has no interest at 0%', () => {
    const s = amortize({ ...base, principal: 1200, rate: 0, termMonths: 12 });
    expect(s.totalInterest).toBe(0);
    expect(s.rows.every((r) => r.payment === 100)).toBe(true);
  });

  it('extra payments shorten the loan and save interest', () => {
    const plain = amortize(base);
    const extra = amortize({ ...base, extra: 200, extraYearly: 1000 });
    expect(extra.rows.length).toBeLessThan(plain.rows.length);
    expect(extra.totalInterest).toBeLessThan(plain.totalInterest);
    expect(extra.rows.at(-1)!.balance).toBe(0);
    expect(sum(extra.rows.map((r) => r.principal + r.extra))).toBeCloseTo(200_000, 2);
    expect(extra.rows[11].extra).toBe(1200);
    expect(extra.rows[10].extra).toBe(200);
  });

  it('never prepays more than what is owed', () => {
    const s = amortize({ ...base, principal: 1000, termMonths: 12, extra: 5000 });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].balance).toBe(0);
    expect(s.rows[0].principal + s.rows[0].extra).toBeCloseTo(1000, 2);
  });

  it('biweekly pays less interest than monthly over the same term', () => {
    const bi = amortize({ ...base, frequency: 'biweekly' });
    expect(bi.rows).toHaveLength(780);
    expect(bi.totalInterest).toBeLessThan(amortize(base).totalInterest);
  });

  it('charges PMI until the balance reaches 78% of the price', () => {
    const price = 250_000;
    const pmi = pmiPlan(price, 225_000, 0.5)!;
    expect(pmi).toEqual({ yearly: 1125, until: 195_000 });
    const s = amortize({ ...base, principal: 225_000, pmi });
    const charged = s.rows.filter((r) => r.pmi > 0);
    expect(charged[0].pmi).toBe(93.75);
    const last = charged.at(-1)!;
    expect(s.rows[last.n - 2].balance).toBeGreaterThan(195_000);
    expect(last.balance).toBeLessThanOrEqual(195_000);
    expect(s.totalPmi).toBeCloseTo(charged.length * 93.75, 2);
  });

  it('skips PMI with 20% down or no rate', () => {
    expect(pmiPlan(250_000, 200_000, 0.5)).toBeUndefined();
    expect(pmiPlan(250_000, 225_000, 0)).toBeUndefined();
  });
});

describe('byYear', () => {
  it('groups payments by calendar year', () => {
    const s = amortize({ principal: 10_000, rate: 5, termMonths: 24, frequency: 'monthly', start: '2026-07-01' });
    const years = byYear(s.rows);
    expect(years.map((y) => y.year)).toEqual([2026, 2027, 2028]);
    expect(years.at(-1)!.balance).toBe(0);
    expect(sum(years.map((y) => y.principal))).toBeCloseTo(10_000, 2);
    expect(sum(years.map((y) => y.interest))).toBeCloseTo(s.totalInterest, 2);
  });
});

describe('escrow and CSV', () => {
  it('spreads yearly costs over the payments', () => {
    expect(escrowPerPayment(3600, 1200, 50, 'monthly')).toEqual({ tax: 300, insurance: 100, hoa: 50 });
    expect(escrowPerPayment(2600, 0, 0, 'biweekly').tax).toBe(100);
  });

  it('writes one line per payment with a header', () => {
    const s = amortize({ principal: 1200, rate: 0, termMonths: 12, frequency: 'monthly', start: '2026-01-15' });
    const csv = scheduleCsv(s.rows).split('\r\n');
    expect(csv).toHaveLength(13);
    expect(csv[0]).toBe('Payment,Date,Principal & interest,Principal,Interest,Extra principal,Balance');
    expect(csv[1]).toBe('1,2026-01-15,100.00,100.00,0.00,0.00,1100.00');
    const withEscrow = scheduleCsv(s.rows, { tax: 10, insurance: 5, hoa: 0 }).split('\r\n');
    expect(withEscrow[1]).toBe('1,2026-01-15,100.00,100.00,0.00,0.00,0.00,10.00,5.00,0.00,115.00,1100.00');
  });
});

describe('guessCurrency', () => {
  it('maps a locale to its currency', () => {
    expect(guessCurrency('en-GB')).toBe('GBP');
    expect(guessCurrency('de-DE')).toBe('EUR');
    expect(guessCurrency('ja')).toBe('JPY');
    expect(guessCurrency('en-US')).toBe('USD');
    expect(guessCurrency('xx-QQ')).toBe('USD');
  });
});

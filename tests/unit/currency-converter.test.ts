import { describe, expect, it } from 'vitest';
import {
  CACHE_TTL, convert, currencyForLocale, flag, formatMoney, formatRate, fractionDigits, isFresh, isoDaysAgo,
  parseAmount, readCache, searchCurrencies, sparkPaths, toCache, toSeries,
} from '@/tools/lib/currency-converter/rates';

const rates = { EUR: 1, USD: 1.1188, GBP: 0.8382, JPY: 176.15 };

describe('parseAmount', () => {
  it('reads both decimal conventions', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1 234,5')).toBe(1234.5);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('0.500')).toBe(0.5);
    expect(parseAmount('.5')).toBe(0.5);
  });
  it('treats a lone three-digit group as thousands', () => {
    expect(parseAmount('1,000')).toBe(1000);
    expect(parseAmount('2.500')).toBe(2500);
    expect(parseAmount('1,234,567')).toBe(1234567);
  });
  it('ignores currency symbols and codes', () => {
    expect(parseAmount('$100')).toBe(100);
    expect(parseAmount('100 USD')).toBe(100);
  });
  it('rejects junk', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1.2,3,4')).toBeNull();
  });
});

describe('convert', () => {
  it('crosses through the euro', () => {
    expect(convert(100, 'EUR', 'USD', rates)).toBeCloseTo(111.88);
    expect(convert(111.88, 'USD', 'EUR', rates)).toBeCloseTo(100);
    expect(convert(1, 'GBP', 'JPY', rates)).toBeCloseTo(176.15 / 0.8382);
  });
  it('returns null for unknown currencies', () => {
    expect(convert(1, 'EUR', 'XYZ', rates)).toBeNull();
  });
});

describe('formatting', () => {
  it('uses the currency defaults for normal amounts', () => {
    expect(formatMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatMoney(1234.5, 'JPY', 'en-US')).toBe('¥1,235');
  });
  it('adds decimals for tiny amounts', () => {
    expect(fractionDigits(0.0063, 'USD')).toBe(5);
    expect(formatMoney(0.006351, 'USD', 'en-US')).toBe('$0.00635');
    expect(formatMoney(0.5, 'USD', 'en-US')).toBe('$0.50');
  });
  it('formats unit rates to about five significant digits', () => {
    expect(formatRate(0.893821, 'en-US')).toBe('0.8938');
    expect(formatRate(176.153, 'en-US')).toBe('176.15');
    expect(formatRate(20320.32, 'en-US')).toBe('20,320');
    // 1 IDR in EUR must not round to 0
    expect(formatRate(1 / 20320.32, 'en-US')).toBe('0.00004921');
  });
});

describe('flag', () => {
  it('builds regional indicator pairs', () => {
    expect(flag('USD')).toBe('🇺🇸');
    expect(flag('EUR')).toBe('🇪🇺');
    expect(flag('XAU')).toBe('');
  });
});

describe('currencyForLocale', () => {
  const codes = Object.keys(rates);
  it('maps regions to currencies', () => {
    expect(currencyForLocale('en-GB', codes)).toBe('GBP');
    expect(currencyForLocale('de-DE', codes)).toBe('EUR');
    expect(currencyForLocale('en', codes)).toBeNull();
  });
});

describe('searchCurrencies', () => {
  const names: Record<string, string> = { USD: 'US Dollar', AUD: 'Australian Dollar', EUR: 'Euro', GBP: 'British Pound' };
  const codes = Object.keys(names);
  it('ranks exact code above name matches', () => {
    expect(searchCurrencies('usd', codes, (c) => names[c])).toEqual(['USD']);
    expect(searchCurrencies('dollar', codes, (c) => names[c])).toEqual(['USD', 'AUD']);
    expect(searchCurrencies('', codes, (c) => names[c])).toEqual(codes);
  });
});

describe('cache', () => {
  it('normalises and validates', () => {
    const c = toCache({ base: 'EUR', date: '2026-10-26', rates: { USD: 1.1, BAD: 'x' } }, 1000);
    expect(c.rates).toEqual({ EUR: 1, USD: 1.1 });
    expect(readCache(JSON.stringify(c))).toEqual(c);
    expect(readCache('{oops')).toBeNull();
    expect(() => toCache({ base: 'USD' }, 0)).toThrow();
  });
  it('expires after 12 hours', () => {
    const c = toCache({ base: 'EUR', date: '2026-10-26', rates: {} }, 0);
    expect(isFresh(c, CACHE_TTL - 1)).toBe(true);
    expect(isFresh(c, CACHE_TTL)).toBe(false);
  });
});

describe('series', () => {
  it('orders points and draws paths', () => {
    const s = toSeries({ rates: { '2026-10-02': { EUR: 0.9 }, '2026-10-01': { EUR: 0.8 } } }, 'EUR');
    expect(s.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02']);
    const { line, min, max, coords } = sparkPaths(s, 100, 50, 5);
    expect([min, max]).toEqual([0.8, 0.9]);
    expect(coords).toEqual([[0, 45], [100, 5]]);
    expect(line).toBe('M0.00 45.00 L100.00 5.00');
  });
  it('counts days back in UTC', () => {
    expect(isoDaysAgo(30, new Date('2026-10-26T12:00:00Z'))).toBe('2026-09-26');
  });
});

import { describe, expect, it } from 'vitest';
import { guessesInWords, passwordChecks } from '@/tools/lib/password-strength/checks';
import { countInRange, sha1Hex } from '@/tools/lib/password-strength/hibp';
import { loadZxcvbn } from '@/tools/lib/password-strength/zxcvbn';

const passed = (pw: string) => Object.fromEntries(passwordChecks(pw).map((c) => [c.label, c.pass]));

describe('passwordChecks', () => {
  it('flags each character class', () => {
    const r = passed('abc');
    expect(r['Lowercase letters']).toBe(true);
    expect(r['Uppercase letters']).toBe(false);
    expect(r['Numbers']).toBe(false);
    expect(r['Symbols or spaces']).toBe(false);
    expect(r['At least 12 characters']).toBe(false);
  });

  it('counts characters, not UTF-16 units, and understands non-English letters', () => {
    expect(passed('🔑🔑🔑🔑🔑🔑')['At least 12 characters']).toBe(false);
    const r = passed('Ünïcödé pass 9!');
    expect(r['Uppercase letters']).toBe(true);
    expect(r['Symbols or spaces']).toBe(true);
    expect(r['Numbers']).toBe(true);
    expect(r['At least 12 characters']).toBe(true);
  });

  it('spots runs of the same character', () => {
    expect(passed('paaassword')['No character repeated 3+ times in a row']).toBe(false);
    expect(passed('paassword')['No character repeated 3+ times in a row']).toBe(true);
  });
});

describe('guessesInWords', () => {
  it('names big numbers', () => {
    expect(guessesInWords(1)).toBe('about 10 guesses');
    expect(guessesInWords(6)).toBe('about 1 million guesses');
    expect(guessesInWords(10.5)).toBe('about 32 billion guesses');
    expect(guessesInWords(40.2)).toBe('about 10^40 guesses');
    expect(guessesInWords(8.9999)).toBe('about 1 billion guesses');
  });
});

describe('Have I Been Pwned range lookup', () => {
  it('hashes with SHA-1 in upper-case hex', async () => {
    expect(await sha1Hex('password')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
  });

  it('finds the suffix in a range response', () => {
    const body = '003D68EB55068C33ACE09247EE4C639306B:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n1E5A2C6B3BF5A1F7E1B4D9C5E8A3B2F1C0D:0';
    expect(countInRange(body, '1e4c9b93f3f0682250b6cf8331b7ee68fd8')).toBe(9545824);
    expect(countInRange(body, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')).toBe(0);
    // padding entries have a count of 0
    expect(countInRange(body, '1E5A2C6B3BF5A1F7E1B4D9C5E8A3B2F1C0D')).toBe(0);
  });
});

describe('zxcvbn', () => {
  it('rates common and strong passwords sensibly', async () => {
    const check = await loadZxcvbn();
    expect(check('password').score).toBe(0);
    expect(check('correct horse battery staple').score).toBeGreaterThanOrEqual(3);
    expect(check('k9#Vq!2zR7@wLm$4').score).toBe(4);
  });
});

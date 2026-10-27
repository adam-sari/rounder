import { describe, expect, it } from 'vitest';
import JsBarcode from 'jsbarcode';
import { check, checkBatch, code39Mod43, fileNameFor, gs1CheckDigit, jsFormat, msiSuffix, upcEToA, type FormatId } from '@/tools/lib/barcode-generator/formats';

// JsBarcode's own encoders, so our validation is checked against what actually gets drawn
const getModule = (JsBarcode as unknown as { getModule(name: string): new (data: string, options: object) => { data: string; valid(): boolean } }).getModule;
const defaults = { width: 2, height: 100, displayValue: true, fontSize: 20, textMargin: 2 };
const jsValid = (format: string, value: string) => {
  const Encoder = getModule(format);
  return new Encoder(value, { ...defaults }).valid();
};

describe('gs1CheckDigit', () => {
  it('matches published examples', () => {
    expect(gs1CheckDigit('590123412345')).toBe(7);
    expect(gs1CheckDigit('03600029145')).toBe(2);
    expect(gs1CheckDigit('9638507')).toBe(4);
    expect(gs1CheckDigit('1540014128876')).toBe(3);
  });
});

describe('check', () => {
  it('adds a missing check digit', () => {
    const r = check('EAN13', '590123412345');
    expect(r).toMatchObject({ ok: true, value: '5901234123457' });
    expect(r.message).toContain('7');
  });

  it('accepts a correct full code and ignores spaces and dashes', () => {
    expect(check('UPC', '0 36000 29145 2')).toMatchObject({ ok: true, value: '036000291452' });
    expect(check('EAN8', '9638-5074').ok).toBe(true);
  });

  it('flags a wrong check digit and offers the fix', () => {
    const r = check('EAN13', '5901234123450');
    expect(r.ok).toBe(false);
    expect(r.fix).toBe('5901234123457');
    expect(r.message).toMatch(/should be 7, not 0/);
  });

  it('explains wrong lengths and stray characters', () => {
    expect(check('EAN13', '12345').message).toMatch(/12 digits/);
    expect(check('ITF14', '15400A4128876').message).toMatch(/"A"/);
  });

  it('agrees with JsBarcode for every format it accepts', () => {
    const cases: [FormatId, string][] = [
      ['CODE128', 'SKU-10442'], ['EAN13', '590123412345'], ['EAN8', '9638507'], ['UPC', '03600029145'],
      ['UPCE', '654321'], ['UPCE', '0654321'], ['CODE39', 'code-39'], ['ITF14', '1540014128876'],
      ['MSI', '1234567'], ['codabar', '40156'], ['codabar', 'a40156b'], ['pharmacode', '1234'],
    ];
    for (const [format, raw] of cases) {
      const r = check(format, raw);
      expect(r.ok, `${format} ${raw}`).toBe(true);
      expect(jsValid(jsFormat(format), r.value), `${format} ${r.value}`).toBe(true);
    }
  });

  it('rejects what JsBarcode would reject', () => {
    expect(check('CODE128', 'café').ok).toBe(false);
    expect(check('CODE39', 'a_b').ok).toBe(false);
    expect(check('codabar', 'A123').ok).toBe(false);
    expect(check('pharmacode', '2').ok).toBe(false);
    expect(check('pharmacode', '131071').ok).toBe(false);
    expect(check('UPCE', '2654321').ok).toBe(false);
    expect(check('CODE128', '   ').ok).toBe(false);
  });

  it('upper-cases Code 39 and mentions it', () => {
    const r = check('CODE39', 'abc', { mod43: true });
    expect(r.value).toBe('ABC');
    expect(r.message).toMatch(/capitals/);
    expect(r.message).toContain('"X"');
  });
});

describe('UPC-E', () => {
  it('expands to the matching UPC-A', () => {
    expect(upcEToA('654321')).toBe('065100004327');
    expect(upcEToA('123455')).toBe('012345000058');
  });
  it('verifies the check digit of 8-digit codes', () => {
    expect(check('UPCE', '06543217').ok).toBe(true);
    expect(check('UPCE', '06543210')).toMatchObject({ ok: false, fix: '06543217' });
  });
});

describe('MSI and Code 39 checks', () => {
  it('computes the same digits JsBarcode appends', () => {
    for (const scheme of ['MSI10', 'MSI11', 'MSI1010', 'MSI1110'] as const) {
      for (const digits of ['1234567', '80523', '9']) {
        const Encoder = getModule(scheme);
        expect(new Encoder(digits, { ...defaults }).data, `${scheme} ${digits}`).toBe(digits + msiSuffix(digits, scheme));
      }
    }
    expect(msiSuffix('1234567', 'MSI')).toBe('');
  });
  it('mod 43 follows the Code 39 character table', () => {
    expect(code39Mod43('ABC')).toBe('X');
    expect(code39Mod43('0')).toBe('0');
  });
});

describe('batch', () => {
  it('skips blank lines and keeps line numbers', () => {
    const lines = checkBatch('590123412345\n\n5901234123450\n', 'EAN13');
    expect(lines.map((l) => [l.line, l.ok])).toEqual([[1, true], [3, false]]);
    expect(lines[1].fix).toBe('5901234123457');
  });
});

describe('fileNameFor', () => {
  it('makes safe, readable names', () => {
    expect(fileNameFor('SKU 10/44', 'png')).toBe('SKU-10-44.png');
    expect(fileNameFor('../..', 'svg')).toBe('barcode.svg');
    expect(fileNameFor('x'.repeat(80), 'png')).toBe(`${'x'.repeat(60)}.png`);
  });
});

import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, duplicateInvoice, emptyBusiness, invoiceFileName, newInvoice, nextNumber, parseStore, serializeStore, suggestNumber } from '@/tools/lib/invoice-generator/invoice';
import { allocate, computeTotals, currencyDigits, divRound, formatMoney, parseScaled, type TotalsInput } from '@/tools/lib/invoice-generator/money';
import { layoutInvoice, readableOn, wrap, type Measure } from '@/tools/lib/invoice-generator/layout';

const base: TotalsInput = { items: [], digits: 2, taxMode: 'none', taxRate: '', discountKind: 'percent', discount: '', paid: '', rounding: 'total' };
const item = (qty: string, price: string, tax = '') => ({ qty, price, tax });

describe('parseScaled', () => {
  it('reads plain and grouped decimals exactly', () => {
    expect(parseScaled('12.5', 2)).toBe(1250);
    expect(parseScaled('1,234.56', 2)).toBe(123456);
    expect(parseScaled('1.234,56', 2)).toBe(123456);
    expect(parseScaled('12,5', 2)).toBe(1250);
    expect(parseScaled('1,000', 2)).toBe(100000);
    expect(parseScaled('1 000 000', 0)).toBe(1000000);
    expect(parseScaled('$ 40', 2)).toBe(4000);
    expect(parseScaled('-3.5', 2)).toBe(-350);
  });

  it('rounds extra decimals half away from zero, without float drift', () => {
    expect(parseScaled('1.005', 2)).toBe(101);
    expect(parseScaled('0.125', 2)).toBe(13);
    expect(parseScaled('-0.125', 2)).toBe(-13);
    expect(parseScaled('8.875', 4)).toBe(88750);
  });

  it('rejects text that is not a number', () => {
    expect(parseScaled('', 2)).toBeNull();
    expect(parseScaled('abc', 2)).toBeNull();
    expect(parseScaled('5-', 2)).toBeNull();
    expect(parseScaled('9'.repeat(20), 2)).toBeNull();
  });
});

describe('divRound and allocate', () => {
  it('rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
  });

  it('splits a discount so the parts always add up', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [300, 0, 700])).toEqual([3, 0, 7]);
    expect(allocate(7, [-50, 100])).toEqual([0, 7]);
    const parts = allocate(999, [333, 333, 334, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(999);
  });
});

describe('computeTotals', () => {
  it('multiplies quantity by price per line in cents', () => {
    const t = computeTotals({ ...base, items: [item('3', '19.99'), item('1.5', '80'), item('0.333', '10')] });
    expect(t.lines).toEqual([5997, 12000, 333]);
    expect(t.subtotal).toBe(18330);
    expect(t.total).toBe(18330);
  });

  it('shows the difference between rounding tax per line and on the total', () => {
    // three lines of $0.35 at 10%: 3.5¢ each rounds up to 4¢, but 10.5¢ on the total rounds to 11¢
    const items = [item('1', '0.35'), item('1', '0.35'), item('1', '0.35')];
    const perLine = computeTotals({ ...base, items, taxMode: 'global', taxRate: '10', rounding: 'line' });
    const onTotal = computeTotals({ ...base, items, taxMode: 'global', taxRate: '10', rounding: 'total' });
    expect(perLine.tax).toBe(12);
    expect(onTotal.tax).toBe(11);
    expect(perLine.total).toBe(117);
    expect(onTotal.total).toBe(116);
  });

  it('groups line taxes by rate', () => {
    const t = computeTotals({ ...base, items: [item('1', '100', '20'), item('2', '50', '5'), item('1', '10', '20'), item('1', '10', '')], taxMode: 'line' });
    expect(t.taxes).toEqual([
      { rate: 50000, base: 10000, amount: 500 },
      { rate: 200000, base: 11000, amount: 2200 },
    ]);
    expect(t.total).toBe(22000 + 2700);
  });

  it('takes a discount off before tax, spread over the lines', () => {
    const t = computeTotals({ ...base, items: [item('1', '100', '20'), item('1', '100', '0')], taxMode: 'line', discountKind: 'percent', discount: '10' });
    expect(t.discount).toBe(2000);
    expect(t.taxes).toEqual([{ rate: 200000, base: 9000, amount: 1800 }]);
    expect(t.total).toBe(20000 - 2000 + 1800);
  });

  it('caps a fixed discount at the subtotal and tracks payments', () => {
    const t = computeTotals({ ...base, items: [item('1', '50')], discountKind: 'amount', discount: '80' });
    expect(t.discount).toBe(5000);
    expect(t.total).toBe(0);
    const p = computeTotals({ ...base, items: [item('2', '50')], paid: '30' });
    expect(p.due).toBe(7000);
  });

  it('respects zero-decimal currencies', () => {
    const t = computeTotals({ ...base, digits: currencyDigits('JPY'), items: [item('3', '1,250.6')], taxMode: 'global', taxRate: '10' });
    expect(t.lines).toEqual([3753]);
    expect(t.tax).toBe(375);
  });
});

describe('formatting', () => {
  it('formats minor units with the currency precision', () => {
    expect(formatMoney(123456, 'USD', 'en-US')).toBe('$1,234.56');
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500');
    expect(formatMoney(1234, 'KWD', 'en-US')).toMatch(/1\.234/);
    expect(formatMoney(100, 'EUR', 'fr-FR')).not.toMatch(/ /);
  });
});

describe('invoice numbers and dates', () => {
  it('increments the last number in the string, keeping padding', () => {
    expect(nextNumber('INV-0041')).toBe('INV-0042');
    expect(nextNumber('INV-0999')).toBe('INV-1000');
    expect(nextNumber('2026-09/7')).toBe('2026-09/8');
    expect(nextNumber('A99B')).toBe('A100B');
    expect(nextNumber('draft')).toBe('draft-2');
    expect(nextNumber('')).toBe('INV-0001');
  });

  it('adds days across month ends and measures windows', () => {
    expect(addDays('2026-01-30', 30)).toBe('2026-03-01');
    expect(addDays('nope', 3)).toBe('');
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });

  it('suggests the number after the newest invoice and duplicates cleanly', () => {
    const a = { ...newInvoice(emptyBusiness(), { number: 'INV-0007', currency: 'USD', paper: 'letter' }), created: 1 };
    const b = { ...newInvoice(emptyBusiness(), { number: 'INV-0003', currency: 'USD', paper: 'letter' }), created: 2 };
    expect(suggestNumber([a, b])).toBe('INV-0004');
    const copy = duplicateInvoice({ ...a, paid: '10' }, 'INV-0008');
    expect(copy.id).not.toBe(a.id);
    expect(copy.number).toBe('INV-0008');
    expect(copy.paid).toBe('');
    expect(copy.items[0].id).not.toBe(a.items[0].id);
  });

  it('builds safe file names', () => {
    expect(invoiceFileName({ title: 'Invoice', number: 'INV/0042' })).toBe('invoice-INV-0042.pdf');
    expect(invoiceFileName({ title: '', number: '' }, 'json')).toBe('invoice.json');
  });
});

describe('parseStore', () => {
  const defaults = { currency: 'EUR', paper: 'a4' as const };

  it('accepts a single exported invoice and fills in defaults', () => {
    const s = parseStore(JSON.stringify({ number: 'X-1', items: [{ description: 'Work', qty: 2, price: '10' }], template: 'weird', currency: 'gbp' }), defaults)!;
    expect(s.invoices).toHaveLength(1);
    expect(s.invoices[0].template).toBe('modern');
    expect(s.invoices[0].currency).toBe('GBP');
    expect(s.invoices[0].items[0].qty).toBe('2');
  });

  it('stores a shared logo once and restores it on every invoice', () => {
    const logo = `data:image/png;base64,${'A'.repeat(4000)}`;
    const other = `data:image/png;base64,${'B'.repeat(40)}`;
    const business = { ...emptyBusiness(), name: 'Acme', logo };
    const a = newInvoice(business, { number: 'INV-0001', currency: 'USD', paper: 'letter' });
    const b = newInvoice(business, { number: 'INV-0002', currency: 'USD', paper: 'letter' });
    const c = newInvoice({ ...business, logo: other }, { number: 'INV-0003', currency: 'USD', paper: 'letter' });
    const json = serializeStore({ business, invoices: [a, b, c], current: b.id });
    expect(json.split(logo).length - 1).toBe(1);
    const s = parseStore(json, defaults)!;
    expect(s.invoices.map((i) => i.from.logo)).toEqual([logo, logo, other]);
    expect(s.current).toBe(b.id);
  });

  it('rejects junk and drops logos that are not our PNG data URLs', () => {
    expect(parseStore('not json', defaults)).toBeNull();
    expect(parseStore('{"hello":1}', defaults)).toBeNull();
    const s = parseStore(JSON.stringify({ invoices: [{ items: [], from: { logo: 'https://evil.example/x.png' } }] }), defaults)!;
    expect(s.invoices[0].from.logo).toBe('');
  });
});

describe('layout', () => {
  const measure: Measure = (s, size) => s.length * size * 0.5;

  it('wraps on spaces, keeps blank lines and splits long words', () => {
    expect(wrap('aaa bbb ccc', 30, 10, 'regular', measure)).toEqual(['aaa', 'bbb', 'ccc']);
    expect(wrap('ab\n\ncd', 100, 10, 'regular', measure)).toEqual(['ab', '', 'cd']);
    expect(wrap('abcdefghij', 25, 10, 'regular', measure)).toEqual(['abcde', 'fghij']);
    // tabs pasted from a spreadsheet would crash PDF font measuring
    expect(wrap('a\tb\r\nc', 100, 10, 'regular', measure)).toEqual(['a b', 'c']);
  });

  it('picks readable text for the accent color', () => {
    expect(readableOn('#1f3a5f')).toBe('#ffffff');
    expect(readableOn('#ffd25e')).toBe('#1d1c1a');
  });

  it('flows long item lists onto more pages with page numbers', () => {
    const inv = newInvoice(emptyBusiness(), { number: 'INV-0001', currency: 'USD', paper: 'a4' });
    inv.items = Array.from({ length: 60 }, (_, i) => ({ id: String(i), description: `Item ${i}`, qty: '1', price: '10', tax: '' }));
    const totals = computeTotals({ ...base, items: inv.items });
    const f = { money: (n: number) => formatMoney(n, 'USD', 'en-US'), date: (s: string) => s, number: String };
    for (const template of ['classic', 'modern', 'minimal'] as const) {
      const layout = layoutInvoice({ ...inv, template }, totals, f, measure, null);
      expect(layout.pages.length).toBeGreaterThan(1);
      for (const page of layout.pages) {
        for (const op of page) if (op.t === 'text') expect(op.y).toBeLessThanOrEqual(layout.height);
        expect(page.some((op) => op.t === 'text' && /Page \d of \d/.test(op.text))).toBe(true);
      }
    }
  });
});

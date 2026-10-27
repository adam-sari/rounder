import { describe, expect, it } from 'vitest';
import { columnStats, detectType, sampleColumn, sortOrder, toNumber, toTime } from '../../src/tools/lib/csv/profile';

describe('parsing values', () => {
  it('reads plain and grouped numbers', () => {
    expect(toNumber(' 1,234.5 ')).toBe(1234.5);
    expect(toNumber('-.5')).toBe(-0.5);
    expect(toNumber('007')).toBe(7);
    expect(toNumber('12,34')).toBeNaN();
    expect(toNumber('$5')).toBeNaN();
  });

  it('reads ISO dates only', () => {
    expect(toTime('2024-03-01')).toBe(Date.UTC(2024, 2, 1));
    expect(toTime('2024-03-01 09:30')).not.toBeNaN();
    expect(toTime('03/01/2024')).toBeNaN();
  });
});

describe('detectType', () => {
  it('finds the type all values share', () => {
    expect(detectType(['1', '2.5', '', '1,000'])).toBe('number');
    expect(detectType(['2024-01-01', '2023-12-31T10:00:00Z'])).toBe('date');
    expect(detectType(['yes', 'No', 'TRUE'])).toBe('boolean');
    expect(detectType(['1', 'two'])).toBe('text');
    expect(detectType(['', ' '])).toBe('empty');
  });
});

describe('sampleColumn', () => {
  it('skips deleted rows and spreads the sample', () => {
    const rows = Array.from({ length: 10 }, (_, i) => (i === 4 ? null : [String(i)]));
    expect(sampleColumn(rows, 0, 5)).toEqual(['0', '2', '6', '8']);
  });
});

describe('columnStats', () => {
  it('summarises a number column', () => {
    const s = columnStats(['3', '1,000', '', '3', 'n/a', '-2'], 'number');
    expect(s).toMatchObject({ count: 5, empty: 1, unique: 4, min: '-2', max: '1,000', sum: 1004 });
    expect(s.mean).toBeCloseTo(251);
    expect(s.top).toEqual([['3', 2]]);
  });

  it('finds the earliest and latest dates', () => {
    expect(columnStats(['2024-05-01', '2023-01-09', '2024-12-25'], 'date')).toMatchObject({ min: '2023-01-09', max: '2024-12-25' });
  });

  it('ranks the most repeated text values', () => {
    const s = columnStats(['a', 'b', 'b', 'c', 'c', 'c', 'd', 'd', 'e', 'e', 'e', 'e'], 'text');
    expect(s.top).toEqual([['e', 4], ['c', 3], ['b', 2]]);
    expect(s.mean).toBeUndefined();
  });
});

describe('sortOrder', () => {
  const pick = (values: string[], order: Uint32Array) => [...order].map((i) => values[i]);

  it('sorts numbers by value with blanks last both ways', () => {
    const v = ['10', '', '9', '-1', '1,000'];
    expect(pick(v, sortOrder(v, 'number', false))).toEqual(['-1', '9', '10', '1,000', '']);
    expect(pick(v, sortOrder(v, 'number', true))).toEqual(['1,000', '10', '9', '-1', '']);
  });

  it('sorts text naturally and ignores case', () => {
    const v = ['item 10', 'Item 2', '', 'apple'];
    expect(pick(v, sortOrder(v, 'text', false))).toEqual(['apple', 'Item 2', 'item 10', '']);
  });

  it('keeps equal values in their original order', () => {
    const v = ['b', 'a', 'B', 'a'];
    expect([...sortOrder(v, 'text', false)]).toEqual([1, 3, 0, 2]);
  });
});

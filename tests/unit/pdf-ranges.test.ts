import { describe, expect, it } from 'vitest';
import { formatPageRanges, PageRangeError, parsePageRangeGroups, parsePageRanges } from '@/engines/pdf/ranges';

const parse = (s: string, n = 10) => parsePageRanges(s, n);
const fails = (s: string, n = 10) => {
  try {
    parsePageRanges(s, n);
  } catch (e) {
    expect(e).toBeInstanceOf(PageRangeError);
    return (e as Error).message;
  }
  throw new Error(`expected "${s}" to fail`);
};

describe('parsePageRanges', () => {
  it('reads single pages and ranges as 0-based indexes', () => {
    expect(parse('1')).toEqual([0]);
    expect(parse('1-3, 5')).toEqual([0, 1, 2, 4]);
    expect(parse('2-2')).toEqual([1]);
  });

  it('handles open ends', () => {
    expect(parse('8-')).toEqual([7, 8, 9]);
    expect(parse('-3')).toEqual([0, 1, 2]);
    expect(parse('1-3, 5, 8-')).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });

  it('understands "last" and "end"', () => {
    expect(parse('last')).toEqual([9]);
    expect(parse('END')).toEqual([9]);
    expect(parse('8-last')).toEqual([7, 8, 9]);
    expect(parse('last-8')).toEqual([9, 8, 7]);
    expect(parsePageRanges('last', 1)).toEqual([0]);
  });

  it('keeps reversed ranges reversed', () => {
    expect(parse('5-3')).toEqual([4, 3, 2]);
    expect(parse('3-1, 4')).toEqual([2, 1, 0, 3]);
  });

  it('is relaxed about spaces, separators and dashes', () => {
    expect(parse('  1 - 3 ,5 ')).toEqual([0, 1, 2, 4]);
    expect(parse('1;2;3')).toEqual([0, 1, 2]);
    expect(parse('1 3 5')).toEqual([0, 2, 4]);
    expect(parse('1,,2,')).toEqual([0, 1]);
    expect(parse('1–3')).toEqual([0, 1, 2]); // en dash
    expect(parse('1—3')).toEqual([0, 1, 2]); // em dash
    expect(parse('1\n2')).toEqual([0, 1]);
  });

  it('supports all, odd and even', () => {
    expect(parse('all', 3)).toEqual([0, 1, 2]);
    expect(parse('odd', 5)).toEqual([0, 2, 4]);
    expect(parse('even', 5)).toEqual([1, 3]);
    expect(fails('even', 1)).toMatch(/no even pages/);
  });

  it('keeps duplicates in typed order unless unique', () => {
    expect(parse('3, 1-3')).toEqual([2, 0, 1, 2]);
    expect(parsePageRanges('3, 1-3', 10, { unique: true })).toEqual([2, 0, 1]);
  });

  it('rejects pages that do not exist', () => {
    expect(fails('11')).toBe("Page 11 doesn't exist. This PDF has 10 pages.");
    expect(fails('9-12')).toMatch(/Page 12 doesn't exist/);
    expect(fails('5-', 1)).toBe("Page 5 doesn't exist. This PDF has 1 page.");
    expect(fails('0')).toBe('Page numbers start at 1.');
    expect(fails('0-2')).toBe('Page numbers start at 1.');
  });

  it('rejects things that are not ranges', () => {
    expect(fails('')).toMatch(/Enter the pages/);
    expect(fails(' , ')).toMatch(/Enter the pages/);
    expect(fails('abc')).toBe('"abc" isn\'t a page number or range. Try something like 1-3, 5.');
    expect(fails('1.5')).toMatch(/isn't a page number/);
    expect(fails('1-2-3')).toMatch(/more than one dash/);
    expect(fails('-')).toMatch(/at least one side/);
    expect(fails('1', 0)).toMatch(/no pages/);
  });
});

describe('parsePageRangeGroups', () => {
  it('keeps each part separate, for splitting by ranges', () => {
    expect(parsePageRangeGroups('1-2, 3, 4-', 5)).toEqual([[0, 1], [2], [3, 4]]);
  });
});

describe('formatPageRanges', () => {
  it('collapses runs and round-trips', () => {
    expect(formatPageRanges([0, 1, 2, 4, 7, 8])).toBe('1-3, 5, 8-9');
    expect(formatPageRanges([])).toBe('');
    expect(formatPageRanges([3])).toBe('4');
    expect(formatPageRanges([2, 1, 0])).toBe('3, 2, 1');
    expect(parse(formatPageRanges([0, 1, 2, 4, 7, 8]))).toEqual([0, 1, 2, 4, 7, 8]);
  });
});

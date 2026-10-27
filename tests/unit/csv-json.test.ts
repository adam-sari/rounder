import { describe, expect, it } from 'vitest';
import { csvToJson, jsonToTable, parseJsonInput, typeValue, uniqueHeaders, type CsvToJsonOptions } from '../../src/tools/lib/csv/convert';
import { decodeText, fileProblem } from '../../src/tools/lib/csv/text';
import { toCsv } from '../../src/tools/lib/csv/write';

const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const opts = (o: Partial<CsvToJsonOptions> = {}): CsvToJsonOptions => ({ header: true, typed: true, nested: false, shape: 'objects', keyColumn: 0, ...o });

describe('typeValue', () => {
  it('types numbers, booleans and nulls', () => {
    expect(typeValue('42')).toBe(42);
    expect(typeValue('-3.5e2')).toBe(-350);
    expect(typeValue('TRUE')).toBe(true);
    expect(typeValue('false')).toBe(false);
    expect(typeValue('')).toBeNull();
    expect(typeValue('NULL')).toBeNull();
  });

  it('keeps zip codes, long IDs and odd numbers as text', () => {
    expect(typeValue('01234')).toBe('01234');
    expect(typeValue('12345678901234567890')).toBe('12345678901234567890');
    expect(typeValue('1,000')).toBe('1,000');
    expect(typeValue('+5')).toBe('+5');
    expect(typeValue(' 7')).toBe(' 7');
    expect(typeValue('0')).toBe(0);
    expect(typeValue('0.25')).toBe(0.25);
  });
});

describe('uniqueHeaders', () => {
  it('fills blanks and renames repeats', () => {
    expect(uniqueHeaders(['id', '', 'id', 'id'], 5)).toEqual(['id', 'column2', 'id_2', 'id_3', 'column5']);
  });
});

describe('csvToJson', () => {
  const rows = [
    ['id', 'name', 'address.city', 'address.zip', 'active'],
    ['1', 'Ada', 'London', '01234', 'true'],
    ['2', 'Grace', 'New York', '10001', 'false'],
  ];

  it('makes an array of typed objects', () => {
    expect(plain(csvToJson(rows, opts()).value)).toEqual([
      { id: 1, name: 'Ada', 'address.city': 'London', 'address.zip': '01234', active: true },
      { id: 2, name: 'Grace', 'address.city': 'New York', 'address.zip': 10001, active: false },
    ]);
  });

  it('nests dot keys', () => {
    const [first] = plain(csvToJson(rows, opts({ nested: true, typed: false })).value);
    expect(first).toEqual({ id: '1', name: 'Ada', address: { city: 'London', zip: '01234' }, active: 'true' });
  });

  it('leaves dot keys flat when they would clash', () => {
    const value = plain(csvToJson([['a', 'a.b', 'x..y'], ['1', '2', '3']], opts({ nested: true })).value);
    expect(value).toEqual([{ a: 1, 'a.b': 2, 'x..y': 3 }]);
  });

  it('makes arrays of arrays with the header first', () => {
    expect(plain(csvToJson(rows.slice(0, 2), opts({ shape: 'arrays' })).value)).toEqual([
      ['id', 'name', 'address.city', 'address.zip', 'active'],
      [1, 'Ada', 'London', '01234', true],
    ]);
  });

  it('keys rows by a column and counts repeats', () => {
    const { value, duplicates } = csvToJson([['code', 'n'], ['a', '1'], ['b', '2'], ['a', '3']], opts({ shape: 'keyed' }));
    expect(plain(value)).toEqual({ a: { n: 3 }, b: { n: 2 } });
    expect(duplicates).toBe(1);
  });

  it('names columns when there is no header and keeps ragged cells', () => {
    expect(plain(csvToJson([['x'], ['y', 'z']], opts({ header: false, typed: false })).value)).toEqual([
      { column1: 'x', column2: '' },
      { column1: 'y', column2: 'z' },
    ]);
  });

  it('treats a "__proto__" header as an ordinary key', () => {
    const [row] = csvToJson([['__proto__'], ['x']], opts()).value as Record<string, unknown>[];
    expect(Object.keys(row)).toEqual(['__proto__']);
    expect(JSON.stringify(row)).toBe('{"__proto__":"x"}');
  });
});

describe('jsonToTable', () => {
  const o = { flatten: true, arrays: 'join' as const };

  it('flattens nested objects with a union of keys in first-seen order', () => {
    const t = jsonToTable([{ a: 1, b: { c: true, d: null } }, { e: 'x', a: 2 }], o);
    expect(t.fields).toEqual(['a', 'b.c', 'b.d', 'e']);
    expect(t.rows).toEqual([['1', 'true', '', ''], ['2', '', '', 'x']]);
  });

  it('joins arrays or keeps them as JSON', () => {
    const data = [{ tags: ['red', 'blue'], pts: [{ x: 1 }] }];
    expect(jsonToTable(data, o).rows).toEqual([['red, blue', '{"x":1}']]);
    expect(jsonToTable(data, { ...o, arrays: 'json' }).rows).toEqual([['["red","blue"]', '[{"x":1}]']]);
  });

  it('keeps nested objects as JSON when flattening is off', () => {
    expect(jsonToTable([{ a: { b: 1 } }], { ...o, flatten: false }).rows).toEqual([['{"b":1}']]);
  });

  it('finds the rows inside a wrapper object', () => {
    const t = jsonToTable({ meta: { page: 1 }, results: [{ id: 1 }, { id: 2 }] }, o);
    expect(t.fields).toEqual(['id']);
    expect(t.rows).toEqual([['1'], ['2']]);
    expect(t.note).toContain('"results"');
  });

  it('turns a map of records into rows with a key column', () => {
    const t = jsonToTable({ ada: { born: 1815 }, alan: { born: 1912 } }, o);
    expect(t.fields).toEqual(['key', 'born']);
    expect(t.rows).toEqual([['ada', '1815'], ['alan', '1912']]);
  });

  it('writes arrays of arrays and plain values as they are', () => {
    expect(jsonToTable([['a', 'b'], [1, 2]], o)).toMatchObject({ fields: [], rows: [['a', 'b'], ['1', '2']] });
    expect(jsonToTable([1, 'two'], o)).toMatchObject({ fields: ['value'], rows: [['1'], ['two']] });
  });
});

describe('toCsv', () => {
  it('quotes only where needed unless asked', () => {
    const t = { fields: ['a', 'b'], rows: [['x, y', 'say "hi"'], ['1', '2']] };
    expect(toCsv(t, { delimiter: ',', quoteAll: false })).toBe('a,b\r\n"x, y","say ""hi"""\r\n1,2');
    expect(toCsv(t, { delimiter: ';', quoteAll: true })).toBe('"a";"b"\r\n"x, y";"say ""hi"""\r\n"1";"2"');
  });
});

describe('parseJsonInput', () => {
  it('reads JSON Lines', () => {
    expect(parseJsonInput('{"a":1}\n{"a":2}\n')).toEqual({ value: [{ a: 1 }, { a: 2 }], note: 'Read as JSON Lines, one record per line.' });
  });

  it('points at the error in broken JSON', () => {
    expect(() => parseJsonInput('[{"a": 1,}]')).toThrow(/line 1, column 10/);
  });
});

describe('text helpers', () => {
  it('decodes UTF-8, UTF-16 and Windows-1252', () => {
    expect(decodeText(new TextEncoder().encode('﻿café'))).toBe('café');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe('a');
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
  });

  it('explains spreadsheets and binary files', () => {
    expect(fileProblem('report.xlsx')).toMatch(/Save As/);
    expect(fileProblem('x.csv', 'a\0b')).toMatch(/doesn't look like text/);
    expect(fileProblem('x.csv', 'a,b')).toBe('');
  });
});

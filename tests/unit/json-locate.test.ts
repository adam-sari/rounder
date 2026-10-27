import { describe, expect, it } from 'vitest';
import { locateJsonError } from '../../src/tools/lib/json-locate';

describe('locateJsonError', () => {
  it('returns null for valid JSON', () => {
    expect(locateJsonError('{"a": [1, 2, {"b": null}], "c": "x\\"y"}')).toBeNull();
    expect(locateJsonError('  -1.5e3 ')).toBeNull();
  });

  it('points at a trailing comma in an array', () => {
    expect(locateJsonError('{"name": "Roundy",\n "tools": [1, 2, 3,],\n "ok": true}')).toEqual({
      line: 2, column: 20, reason: 'trailing comma before "]"',
    });
  });

  it('explains single quotes', () => {
    expect(locateJsonError("{'a': 1}")?.reason).toBe('expected a "quoted" key but found "\'"');
    expect(locateJsonError("['a']")?.reason).toBe('JSON strings need double quotes, not single quotes');
  });

  it('catches unclosed strings and missing commas', () => {
    expect(locateJsonError('{"a": "b')?.reason).toBe('a string is never closed');
    expect(locateJsonError('{"a": 1 "b": 2}')).toMatchObject({ line: 1, column: 9 });
  });

  it('flags text after the JSON ends', () => {
    expect(locateJsonError('{} x')?.reason).toBe('unexpected "x" after the end of the JSON');
  });
});

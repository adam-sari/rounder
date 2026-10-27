import { describe, expect, it } from 'vitest';
import { compile, findMatches, groupNames, highlightSegments, parseLiteral, rebaseMatches, toLiteral, toggleFlag } from '@/tools/lib/regex-tester/regex';
import { PRESETS } from '@/tools/lib/regex-tester/presets';

function run(pattern: string, flags: string, text: string) {
  const c = compile(pattern, flags);
  if (!c.ok) throw new Error(c.error);
  return findMatches(c.regex, text);
}

describe('flags', () => {
  it('keeps canonical order and never combines u with v', () => {
    expect(toggleFlag('g', 'i')).toBe('gi');
    expect(toggleFlag('gi', 'd')).toBe('dgi');
    expect(toggleFlag('gi', 'g')).toBe('i');
    expect(toggleFlag('gu', 'v')).toBe('gv');
    expect(toggleFlag('gv', 'u')).toBe('gu');
  });
});

describe('compile', () => {
  it('explains common mistakes', () => {
    const cases: [string, RegExp][] = [
      ['(abc', /never closed/],
      ['abc)', /no \(/],
      ['*a', /nothing in front/],
      ['[abc', /\[ character class/],
      ['[z-a]', /backwards/],
      ['(?<1a>x)', /Group names/],
      ['(?<a>x)(?<a>y)', /share a name/],
    ];
    for (const [pattern, hint] of cases) {
      const c = compile(pattern, 'g');
      expect(c.ok, pattern).toBe(false);
      if (!c.ok) {
        expect(c.hint, pattern).toMatch(hint);
        expect(c.error).not.toMatch(/^Invalid regular expression: \//);
      }
    }
  });

  it('explains u-mode escape errors', () => {
    const c = compile('\\-', 'u');
    expect(!c.ok && c.hint).toMatch(/backslash/);
  });
});

describe('matching', () => {
  it('finds every match with group indices', () => {
    const r = run('(?<y>\\d{4})-(\\d\\d)', 'g', 'a 2024-05 b 1999-12');
    expect(r.total).toBe(2);
    expect(r.matches[1]).toEqual({
      start: 12,
      end: 19,
      value: '1999-12',
      groups: [
        { n: 1, name: 'y', value: '1999', start: 12, end: 16 },
        { n: 2, name: undefined, value: '12', start: 17, end: 19 },
      ],
    });
  });

  it('returns only the first match without g', () => {
    expect(run('a', '', 'aaa').total).toBe(1);
  });

  it('marks groups that did not take part', () => {
    const g = run('(a)|(b)', 'g', 'b').matches[0]!.groups;
    expect(g[0]).toMatchObject({ n: 1, value: undefined, start: undefined });
    expect(g[1]).toMatchObject({ n: 2, value: 'b', start: 0, end: 1 });
  });

  it('steps over empty matches, by code point in unicode mode', () => {
    expect(run('x*', 'g', 'ab').total).toBe(3);
    expect(run('', 'gu', '😀').total).toBe(2);
    expect(run('', 'g', '😀').total).toBe(3);
  });

  it('keeps the first `limit` matches but counts the rest up to the cap', () => {
    const c = compile('a', 'g');
    if (!c.ok) throw new Error();
    const r = findMatches(c.regex, 'a'.repeat(50), 10, 30);
    expect(r.matches.length).toBe(10);
    expect(r.total).toBe(30);
    expect(r.capped).toBe(true);
  });

  it('respects sticky', () => {
    expect(run('a', 'gy', 'aab').total).toBe(2);
    expect(run('a', 'y', 'ba').total).toBe(0);
  });
});

describe('group names', () => {
  it('numbers groups the way the engine does, ignoring escapes and classes', () => {
    expect(groupNames('(a)(?:b)(?<x>c)\\((?=d)[(](?<!e)(f)')).toEqual([undefined, undefined, 'x', undefined]);
  });

  it('treats [ inside a class as literal unless the v flag nests classes', () => {
    expect(groupNames('[[](?<x>a)')).toEqual([undefined, 'x']);
    expect(groupNames('[[a](?<y>b)]', true)).toEqual([undefined]);
    expect(run('[[](?<x>a)(b)', 'g', '[ab').matches[0]!.groups.map((g) => g.name)).toEqual(['x', undefined]);
  });
});

describe('highlight segments', () => {
  it('covers the text exactly, including empty matches', () => {
    const text = 'one two';
    const { matches } = run('\\b', 'g', text);
    const segs = highlightSegments(text, matches);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.filter((s) => s.match !== undefined)).toHaveLength(4);
  });

  it('clamps stale matches to shorter text', () => {
    const segs = highlightSegments('ab', [{ start: 1, end: 9 }]);
    expect(segs).toEqual([{ text: 'a' }, { text: 'b', match: 0 }]);
  });
});

describe('rebasing stale matches', () => {
  const spans = [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 11 },
  ];

  it('shifts matches after an insertion and keeps the ones before it', () => {
    expect(rebaseMatches('one two six', 'one XXtwo six', spans)).toEqual([spans[0], { start: 6, end: 9 }, { start: 10, end: 13 }]);
  });

  it('drops only the matches the edit touches', () => {
    expect(rebaseMatches('one two six', 'one to six', spans)).toEqual([spans[0], null, { start: 7, end: 10 }]);
    expect(rebaseMatches('abc', 'abc', spans)).toEqual(spans);
  });

  it('keeps highlights aligned with the edited text', () => {
    const segs = highlightSegments('one XXtwo six', rebaseMatches('one two six', 'one XXtwo six', spans));
    expect(segs.filter((s) => s.match !== undefined).map((s) => s.text)).toEqual(['one', 'two', 'six']);
  });
});

describe('pasted literals', () => {
  it('splits /pattern/flags into canonical flags', () => {
    expect(parseLiteral(' /a\\/b+/ig ')).toEqual({ pattern: 'a\\/b+', flags: 'gi' });
    expect(parseLiteral('/[/]x/')).toEqual({ pattern: '[/]x', flags: '' });
  });

  it('leaves paths, bad flags and plain patterns alone', () => {
    expect(parseLiteral('/usr/local/')).toBeNull();
    expect(parseLiteral('/a/gg')).toBeNull();
    expect(parseLiteral('/a/uv')).toBeNull();
    expect(parseLiteral('/a/x')).toBeNull();
    expect(parseLiteral('a+b')).toBeNull();
    expect(parseLiteral('//')).toBeNull();
  });
});

describe('literal', () => {
  it('escapes slashes outside classes and keeps existing escapes', () => {
    expect(toLiteral('a/b[/]\\/c', 'gi')).toBe('/a\\/b[/]\\/c/gi');
    expect(toLiteral('', 'g')).toBe('/(?:)/g');
    expect(eval(toLiteral('https?://x', 'g')).source).toBe(new RegExp('https?://x').source);
  });
});

describe('presets', () => {
  const expected: Record<string, string[]> = {
    'Email address': ['ada@example.com', 'ops.team+alerts@mail.rounder.dev'],
    URL: ['https://roundertools.com/regex-tester', 'http://example.org/path?q=1&x=2'],
    'IPv4 address': ['192.168.1.20', '10.0.0.1'],
    'Date (YYYY-MM-DD)': ['2026-10-26', '2026-11-03'],
    'Time (24-hour)': ['09:30', '17:45:10'],
    'Phone number (US)': ['(555) 123-4567', '555.987.6543', '5550001111'],
    'ZIP code (US)': ['94103', '10001-1234'],
    'Hex color': ['#FFD25E', '#131211', '#fff'],
    UUID: ['3f2b8c1e-9a4d-4e7b-8c2f-1d0e5a6b7c8d', '018F4B2E-7C3A-7B21-9D4E-5F6A7B8C9D0E'],
    'Number with commas': ['1,234,567.89', '42', '3.14'],
    'Strong password': ['CorrectHorse42!'],
    'Repeated word': ['is is', 'the The'],
    'HTML tag pair': ['<p class="lead">Hello</p>', '<b>bold</b>'],
  };

  it.each(PRESETS)('$name matches its sample', (p) => {
    expect(run(p.pattern, p.flags, p.sample).matches.map((m) => m.value)).toEqual(expected[p.name]);
  });
});

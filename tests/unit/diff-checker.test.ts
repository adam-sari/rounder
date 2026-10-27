import { describe, expect, it } from 'vitest';
import { diffArrays } from 'diff';
import { buildBlocks, computeDiff, lineMarks, matchLines, splitLines, unifiedPatch, type DiffOptions } from '@/tools/lib/diff-checker/diff';
import { patchFileName, patchNames } from '@/tools/lib/diff-checker/names';
import { buildRows, isFold, pieces, type LineRow } from '@/tools/lib/diff-checker/rows';

const opts: DiffOptions = { granularity: 'words', ignoreWhitespace: false, ignoreCase: false };
const marked = (text: string, marks: number[] | undefined) => pieces(text, marks).filter((p) => p.mark).map((p) => p.text);

describe('splitLines', () => {
  it('handles empty text, trailing newlines and mixed endings', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('\n')).toEqual(['']);
    expect(splitLines('a\r\nb\rc\n')).toEqual(['a', 'b', 'c']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
  });
});

describe('computeDiff', () => {
  it('finds added, removed and changed lines', () => {
    const r = computeDiff('one\ntwo\nthree\nfour', 'one\n2\nthree\nfour\nfive', opts);
    expect(r.blocks).toEqual([
      { equal: true, a: 0, b: 0, na: 1, nb: 1 },
      { equal: false, a: 1, b: 1, na: 1, nb: 1 },
      { equal: true, a: 2, b: 2, na: 2, nb: 2 },
      { equal: false, a: 4, b: 4, na: 0, nb: 1 },
    ]);
    expect([r.added, r.removed, r.changes]).toEqual([2, 1, 2]);
  });

  it('reports identical texts as having no changes', () => {
    const r = computeDiff('same\ntext', 'same\ntext\n', opts);
    expect(r.changes).toBe(0);
    expect(r.blocks).toHaveLength(1);
  });

  it('ignores whitespace and case when asked', () => {
    const a = 'Hello   World\n  indented';
    const b = 'hello world\nindented  ';
    expect(computeDiff(a, b, opts).changes).toBe(1);
    expect(computeDiff(a, b, { ...opts, ignoreWhitespace: true, ignoreCase: true }).changes).toBe(0);
  });

  it('notices different line endings', () => {
    expect(computeDiff('a\r\nb', 'a\nb', opts).eolDiffers).toBe(true);
    expect(computeDiff('a\r\nb', 'a\nb', opts).changes).toBe(0);
    expect(computeDiff('a', 'a\nb', opts).eolDiffers).toBe(false);
  });

  it('highlights the changed words inside a modified line', () => {
    const r = computeDiff('The quick brown fox jumps', 'The quick red fox jumps', opts);
    expect(marked(r.linesA[0], r.marksA.get(0))).toEqual(['brown']);
    expect(marked(r.linesB[0], r.marksB.get(0))).toEqual(['red']);
  });
});

describe('lineMarks', () => {
  it('works by characters', () => {
    const m = lineMarks('colour', 'color', { ...opts, granularity: 'chars' });
    expect(marked('colour', m![0])).toEqual(['u']);
    expect(m![1]).toEqual([]);
  });

  it('skips highlights for unrelated lines and in lines mode', () => {
    expect(lineMarks('completely different words here', 'nothing alike at all', opts)).toBeNull();
    expect(lineMarks('a b c', 'a b d', { ...opts, granularity: 'lines' })).toBeNull();
  });

  it('never splits an emoji or accented letter', () => {
    const chars = { ...opts, granularity: 'chars' as const };
    const m = lineMarks('flag 🇺🇸 ok', 'flag 🇺🇦 ok', chars);
    expect(marked('flag 🇺🇸 ok', m![0])).toEqual(['🇺🇸']);
    const w = lineMarks('a café au lait with toast 👍🏽', 'a café au lait with toast 👍🏿', opts);
    expect(marked('a café au lait with toast 👍🏿', w![1])).toEqual(['café', '👍🏿']);
  });

  it('drops whitespace-only highlights when ignoring whitespace', () => {
    const m = lineMarks('let x  = 1', 'let x = 2', { ...opts, ignoreWhitespace: true });
    expect(marked('let x  = 1', m![0])).toEqual(['1']);
  });
});

describe('matchLines', () => {
  const lcs = (a: string[], b: string[]) => diffArrays(a, b).filter((c) => !c.added && !c.removed).reduce((n, c) => n + c.count, 0);

  it('matches as many lines as a plain diff', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) % 6).toString();
    for (let t = 0; t < 30; t++) {
      const a = Array.from({ length: 40 }, rand);
      const b = Array.from({ length: 35 }, () => (rand() === '0' ? `only-b-${t}` : rand()));
      const { pairs, approximate } = matchLines(a, b);
      expect(approximate).toBe(false);
      expect(pairs.length).toBe(lcs(a, b));
      for (const [x, y] of pairs) expect(a[x]).toBe(b[y]);
    }
  });

  it('falls back to an in-order anchored match when out of time', () => {
    const a = Array.from({ length: 3000 }, (_, i) => (i % 10 ? `line ${i}` : '}'));
    const b = a.slice(1000).concat(a.slice(0, 1000));
    const { pairs, approximate } = matchLines(a, b, 0);
    expect(approximate).toBe(true);
    for (let k = 0; k < pairs.length; k++) {
      expect(a[pairs[k][0]]).toBe(b[pairs[k][1]]);
      if (k) expect(pairs[k][0] > pairs[k - 1][0] && pairs[k][1] > pairs[k - 1][1]).toBe(true);
    }
    expect(pairs.length).toBeGreaterThanOrEqual(2000);
  });
});

describe('buildRows', () => {
  const big = Array.from({ length: 30 }, (_, i) => `line ${i}`);
  const changed = big.map((l, i) => (i === 15 ? 'changed' : l));
  const blocks = buildBlocks(matchLines(big, changed).pairs, 30, 30);

  it('folds long unchanged runs, keeping context around changes', () => {
    const rows = buildRows(blocks, 'split', true, new Set());
    const folds = rows.filter(isFold);
    expect(folds.map((f) => f.count)).toEqual([12, 11]);
    expect(rows).toHaveLength(9);
    const all = buildRows(blocks, 'split', true, new Set([0, 2]));
    expect(all.filter(isFold)).toHaveLength(0);
    expect(all).toHaveLength(30);
  });

  it('lists removed lines before added ones in unified view', () => {
    const rows = buildRows(buildBlocks([[0, 0]], 3, 3), 'unified', false, new Set()) as LineRow[];
    expect(rows.map((r) => [r.a, r.b])).toEqual([[0, 0], [1, -1], [2, -1], [-1, 1], [-1, 2]]);
    expect(rows.map((r) => r.change)).toEqual([-1, 0, -1, -1, -1]);
  });
});

describe('patch helpers', () => {
  it('names patch files sensibly', () => {
    expect(patchNames('a.txt', 'a.txt')).toEqual(['a/a.txt', 'b/a.txt']);
    expect(patchFileName('report.txt', 'report-v2.txt')).toBe('report-vs-report-v2.diff');
    expect(patchFileName('config.json', 'config.json')).toBe('config.diff');
  });

  it('creates a unified patch', () => {
    const patch = unifiedPatch('a\nb\nc\n', 'a\nB\nc\n', 'original.txt', 'changed.txt')!;
    expect(patch).toContain('--- original.txt');
    expect(patch).toContain('+++ changed.txt');
    expect(patch).toContain('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c');
  });

  it('keeps CRLF line endings so the patch applies to Windows files', () => {
    const patch = unifiedPatch('a\r\nb\r\n', 'a\r\nB\r\n', 'x.txt', 'y.txt')!;
    expect(patch).toContain('-b\r\n+B\r\n');
  });
});

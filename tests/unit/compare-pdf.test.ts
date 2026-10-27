import { describe, expect, it } from 'vitest';
import { countChanged, formatShare, highlightDiff, visibleShare, type Raster } from '@/tools/lib/compare-pdf/pixels';
import { changeLines, reportHtml, reportName, reportText } from '@/tools/lib/compare-pdf/report';
import { alignPages, byNumber, compareTexts, diffPage, foldText, normalizePage, pairLabel, signatures, similarity } from '@/tools/lib/compare-pdf/text';

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');

describe('normalizePage', () => {
  it('drops layout noise but keeps line breaks', () => {
    expect(normalizePage('  Hello   world \n\n\t second line \r\n')).toBe('Hello world\nsecond line');
  });
});

describe('similarity', () => {
  it('scores shared words, and blank pages match each other', () => {
    const [[a, b, blank]] = signatures([['the cat sat', 'the cat ran', '']]);
    expect(similarity(a, a)).toBe(1);
    expect(similarity(a, b)).toBeCloseTo(2 / 3);
    expect(similarity(blank, blank)).toBe(1);
    expect(similarity(a, blank)).toBe(0);
  });
});

describe('alignPages', () => {
  const pages = [words(40, 'a'), words(40, 'b'), words(40, 'c'), words(40, 'd')];

  it('finds an inserted page instead of shifting everything after it', () => {
    const [sa, sb] = signatures([pages, [pages[0], words(40, 'new'), ...pages.slice(1)]]);
    expect(alignPages(sa, sb)).toEqual([[0, 0], [-1, 1], [1, 2], [2, 3], [3, 4]]);
  });

  it('finds a removed page', () => {
    const [sa, sb] = signatures([pages, [pages[0], pages[2], pages[3]]]);
    expect(alignPages(sa, sb)).toEqual([[0, 0], [1, -1], [2, 1], [3, 2]]);
  });

  it('still pairs a page that was rewritten in place', () => {
    const [sa, sb] = signatures([pages, [pages[0], words(40, 'zz'), pages[2], pages[3]]]);
    expect(alignPages(sa, sb)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it('pairs scans (no text) by order', () => {
    const [sa, sb] = signatures([['', '', ''], ['', '']]);
    expect(alignPages(sa, sb).filter(([a, b]) => a >= 0 && b >= 0)).toHaveLength(2);
  });

  it('byNumber pairs 1:1 then lists the extra pages', () => {
    expect(byNumber(2, 3)).toEqual([[0, 0], [1, 1], [-1, 2]]);
  });
});

describe('diffPage', () => {
  it('marks words and groups a phrase edit into one change', () => {
    const { parts } = diffPage('Open 9am to 6pm on weekdays', 'Open 9am to 8pm on most weekdays', 'words');
    expect(parts.filter((p) => p.kind === 'del').map((p) => p.text)).toEqual(['6pm']);
    expect(parts.filter((p) => p.kind === 'add').map((p) => p.text.trim())).toEqual(['8pm', 'most']);
    expect(Math.max(...parts.map((p) => p.hunk)) + 1).toBe(2);
  });

  it('treats a replaced run of words as a single change', () => {
    const { parts } = diffPage('the quick brown fox', 'the slow red fox', 'words');
    expect(new Set(parts.filter((p) => p.hunk >= 0).map((p) => p.hunk)).size).toBe(1);
  });

  it('ignores whitespace-only differences', () => {
    const { parts } = diffPage('one two\nthree', 'one two three', 'words');
    expect(parts.every((p) => p.kind === 'same')).toBe(true);
  });

  it('diffs by line', () => {
    const { parts } = diffPage('a\nb\nc', 'a\nB\nc\nd', 'lines');
    expect(parts.filter((p) => p.kind === 'del').map((p) => p.text.trim())).toEqual(['b']);
    expect(parts.filter((p) => p.kind === 'add').map((p) => p.text.trim())).toEqual(['B', 'd']);
  });
});

describe('compareTexts', () => {
  it('totals changes and counts added and removed pages', () => {
    const r = compareTexts(['Hello world', words(30, 'x')], ['Hello there world', words(30, 'x'), 'Brand new page'], { granularity: 'words', pairing: 'content' });
    expect(r.pairs.map((p) => [p.a, p.b])).toEqual([[0, 0], [1, 1], [-1, 2]]);
    expect(r.pairs[0]).toMatchObject({ added: 1, removed: 0, changes: 1 });
    expect(r.pairs[1].changes).toBe(0);
    expect(r.pairs[2]).toMatchObject({ added: 3, changes: 1 });
    expect(r).toMatchObject({ added: 4, removed: 0, changes: 2, changedPages: 2 });
  });

  it('can pair by page number', () => {
    const r = compareTexts(['a', 'b', 'c'], ['b', 'c'], { granularity: 'words', pairing: 'number' });
    expect(r.pairs.map((p) => [p.a, p.b])).toEqual([[0, 0], [1, 1], [2, -1]]);
  });
});

describe('labels and folding', () => {
  it('labels pairs for people', () => {
    expect(pairLabel({ a: 2, b: 2 })).toBe('Page 3');
    expect(pairLabel({ a: 2, b: 3 })).toBe('Page 3 → 4');
    expect(pairLabel({ a: -1, b: 4 })).toBe('New page 5');
    expect(pairLabel({ a: 1, b: -1 })).toBe('Removed page 2');
  });

  it('folds long unchanged text at word breaks', () => {
    const text = words(200, 'w');
    expect(foldText('short', 50, 50)).toBeNull();
    const f = foldText(text, 60, 60)!;
    expect(f.head.length).toBeLessThanOrEqual(61);
    expect(f.head.endsWith(' ')).toBe(true);
    expect(f.tail.startsWith(' ')).toBe(true);
    expect(f.head + text.slice(f.head.length, text.length - f.tail.length) + f.tail).toBe(text);
    expect(foldText(text, 0, 60)!.head).toBe('');
    expect(f.hidden).toBeGreaterThan(150);
  });
});

const raster = (w: number, h: number, ink: [number, number][] = [], color = [0, 0, 0]): Raster => {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x, y] of ink) data.set([...color, 255], (y * w + x) * 4);
  return { data, width: w, height: h };
};

describe('pixels', () => {
  it('counts differing pixels and ignores tiny shifts in tone', () => {
    const a = raster(10, 10, [[1, 1], [2, 2]]);
    const b = raster(10, 10, [[2, 2], [5, 5]]);
    expect(countChanged(a, b)).toBe(2);
    expect(countChanged(raster(4, 4), raster(4, 4, [[0, 0]], [240, 240, 240]))).toBe(0);
    expect(() => countChanged(raster(2, 2), raster(3, 2))).toThrow();
  });

  it('paints removed ink red and added ink blue', () => {
    const out = highlightDiff(raster(4, 4, [[0, 0]]), raster(4, 4, [[3, 3]]), { cell: 2 });
    const px = (x: number, y: number) => Array.from(out.data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 3));
    expect(out.changed).toBe(2);
    const [r0, , b0] = px(0, 0);
    const [r3, , b3] = px(3, 3);
    expect(r0).toBeGreaterThan(b0);
    expect(b3).toBeGreaterThan(r3);
    // an untouched cell stays a plain light ghost
    expect(px(3, 0)).toEqual([255, 255, 255]);
  });

  it('only calls a page changed past a few stray pixels', () => {
    expect(visibleShare(2, 100_000)).toBe(0);
    expect(visibleShare(500, 100_000)).toBeCloseTo(0.005);
    // one edited digit on a small A4 scan render (357 × 505 px) still counts
    expect(visibleShare(10, 357 * 505)).toBeGreaterThan(0);
    expect(formatShare(0.0004)).toBe('<0.1%');
    expect(formatShare(0.024)).toBe('2.4%');
    expect(formatShare(0.38)).toBe('38%');
  });
});

describe('report', () => {
  const text = compareTexts(['Opening hours: 9am to 6pm on weekdays.', 'Same page here'], ['Opening hours: 9am to 8pm on weekdays.', 'Same page here', '<b>New</b> & shiny'], {
    granularity: 'words',
    pairing: 'content',
  });
  const input = { nameA: 'hours-v1.pdf', nameB: 'hours-v2.pdf', pagesA: 2, pagesB: 3, text, visual: [0.01, 0, 1], date: new Date('2026-10-26T12:00:00Z') };

  it('dates the report by the local calendar day, not UTC', () => {
    const late = new Date(2026, 9, 26, 23, 50);
    const early = new Date(2026, 9, 26, 0, 10);
    for (const date of [late, early]) expect(reportText({ ...input, date })).toContain('Compared 2026-10-26 ');
  });

  it('names the file after both PDFs', () => {
    expect(reportName('hours-v1.pdf', 'hours:v2.PDF', 'txt')).toBe('hours-v1-vs-hours-v2-comparison.txt');
  });

  it('writes changes wdiff style with context', () => {
    expect(changeLines(text.pairs[0])).toEqual(['Opening hours: 9am to [-6pm-]{+8pm+} on weekdays.']);
  });

  it('summarises in plain text', () => {
    const t = reportText(input);
    expect(t).toContain('2 text changes on 2 pages');
    expect(t).toContain('Page 1 · 1 change · looks 1.0% different');
    expect(t).toContain('New page 3 · 1 change');
    expect(t).toContain('Unchanged pages (numbers in the changed file): 2');
  });

  it('escapes PDF text in the HTML report', () => {
    const html = reportHtml(input);
    expect(html).toContain('&lt;b&gt;New&lt;/b&gt; &amp; shiny');
    expect(html).not.toContain('<b>New</b>');
    expect(html).toContain('<del>6pm</del>');
  });
});

describe('scale', () => {
  it('compares two 300-page documents quickly', () => {
    const A = Array.from({ length: 300 }, (_, i) => `${words(350, `p${i}w`)}\nline two of page ${i}`);
    const B = [...A.slice(0, 120), words(200, 'inserted'), ...A.slice(120)];
    B[200] = B[200].replace('p199w10 ', 'edited ');
    const t0 = performance.now();
    const r = compareTexts(A, B, { granularity: 'words', pairing: 'content' });
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(r.pairs.filter((p) => p.a < 0)).toHaveLength(1);
    expect(r.changedPages).toBe(2);
  });
});

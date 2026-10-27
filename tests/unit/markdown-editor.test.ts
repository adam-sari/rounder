import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  continueList,
  cycleHeading,
  insertLink,
  insertTable,
  toggleCode,
  toggleInline,
  toggleLines,
  type Edit,
} from '@/tools/lib/markdown-editor/format';
import { renderBlocks } from '@/tools/lib/markdown-editor/render';
import { buildMap, mapScroll } from '@/tools/lib/markdown-editor/sync';
import { countWords, docTitle, fileBase, standaloneHtml } from '@/tools/lib/markdown-editor/export';

/** applies an edit and shows the selection with [ ] brackets */
function show(text: string, e: Edit) {
  const out = applyEdit(text, e);
  return out.slice(0, e.selStart) + '[' + out.slice(e.selStart, e.selEnd) + ']' + out.slice(e.selEnd);
}

describe('toggleInline', () => {
  it('wraps a selection', () => {
    expect(show('make it bold', toggleInline('make it bold', 8, 12, '**', 'bold text'))).toBe('make it **[bold]**');
  });
  it('inserts a selected placeholder on an empty selection', () => {
    expect(show('a  b', toggleInline('a  b', 2, 2, '*', 'italic text'))).toBe('a *[italic text]* b');
  });
  it('unwraps when the markers sit around the selection', () => {
    const t = 'make it **bold**';
    expect(show(t, toggleInline(t, 10, 14, '**', 'x'))).toBe('make it [bold]');
  });
  it('unwraps when the selection includes the markers', () => {
    const t = 'make it **bold**';
    expect(show(t, toggleInline(t, 8, 16, '**', 'x'))).toBe('make it [bold]');
  });
  it('does not mistake bold for italic', () => {
    const t = '**word**';
    expect(show(t, toggleInline(t, 2, 6, '*', 'x'))).toBe('***[word]***');
    const bi = '***word***';
    expect(show(bi, toggleInline(bi, 3, 7, '*', 'x'))).toBe('**[word]**');
  });
  it('leaves a trailing space outside the markers', () => {
    expect(show('word next', toggleInline('word next', 0, 5, '**', 'x'))).toBe('**[word]** next');
  });
});

describe('line actions', () => {
  it('makes a bulleted list and removes it again', () => {
    const t = 'one\ntwo\n\nthree';
    const e = toggleLines(t, 0, t.length, 'ul');
    const listed = applyEdit(t, e);
    expect(listed).toBe('- one\n- two\n\n- three');
    expect(applyEdit(listed, toggleLines(listed, 0, listed.length, 'ul'))).toBe(t);
  });
  it('numbers lines and converts bullets', () => {
    const t = '- a\n- b';
    expect(applyEdit(t, toggleLines(t, 0, t.length, 'ol'))).toBe('1. a\n2. b');
  });
  it('adds a marker to an empty line with the cursor after it', () => {
    expect(show('x\n', toggleLines('x\n', 2, 2, 'ul'))).toBe('x\n- []');
  });
  it('quotes every line', () => {
    expect(applyEdit('a\n\nb', toggleLines('a\n\nb', 0, 4, 'quote'))).toBe('> a\n>\n> b');
  });
  it('does not take the next line when the selection ends after a newline', () => {
    const t = 'a\nb';
    expect(applyEdit(t, toggleLines(t, 0, 2, 'ul'))).toBe('- a\nb');
  });
  it('cycles headings', () => {
    let t = 'Title';
    t = applyEdit(t, cycleHeading(t, 0, 0));
    expect(t).toBe('# Title');
    t = applyEdit(t, cycleHeading(t, 0, 0));
    expect(t).toBe('## Title');
    t = applyEdit(t, cycleHeading(t, 0, 0));
    expect(t).toBe('### Title');
    expect(applyEdit(t, cycleHeading(t, 0, 0))).toBe('Title');
  });
  it('handles the cursor at the very start of a document that begins with a blank line', () => {
    const t = '\nhello';
    expect(applyEdit(t, cycleHeading(t, 0, 0))).toBe('# \nhello');
    expect(applyEdit(t, toggleLines(t, 0, 0, 'ul'))).toBe('- \nhello');
  });
  it('starts a heading on an empty line', () => {
    expect(show('a\n', cycleHeading('a\n', 2, 2))).toBe('a\n# []');
  });
});

describe('link, code and table', () => {
  it('links selected text and selects the url', () => {
    expect(show('see docs', insertLink('see docs', 4, 8))).toBe('see [docs]([https://])');
  });
  it('wraps a selected url', () => {
    const t = 'https://example.com';
    expect(show(t, insertLink(t, 0, t.length))).toBe('[[link text]](https://example.com)');
  });
  it('keeps the space after a double-clicked word and completes www urls', () => {
    expect(show('see docs next', insertLink('see docs next', 4, 9))).toBe('see [docs]([https://]) next');
    expect(applyEdit('www.example.com', insertLink('www.example.com', 0, 15))).toBe('[link text](https://www.example.com)');
  });
  it('uses inline code for a word and a fence for lines', () => {
    expect(show('run npm', toggleCode('run npm', 4, 7))).toBe('run `[npm]`');
    expect(show('a\nb', toggleCode('a\nb', 0, 3))).toBe('```\n[a\nb]\n```');
    expect(show('x\n\ny', toggleCode('x\n\ny', 2, 2))).toBe('x\n```\n[]\n```\ny');
  });
  it('puts a table on its own lines after the current one', () => {
    const t = 'Intro text\nmore';
    const out = applyEdit(t, insertTable(t, 3));
    expect(out.startsWith('Intro text\n\n| Column 1 |')).toBe(true);
    expect(out.endsWith('| Cell     |\n\nmore')).toBe(true);
    expect(show(t, insertTable(t, 3))).toContain('| [Column 1] |');
  });
});

describe('continueList', () => {
  it('continues bullets, numbers, tasks and quotes', () => {
    expect(show('- a', continueList('- a', 3)!)).toBe('- a\n- []');
    expect(show('  9. a', continueList('  9. a', 6)!)).toBe('  9. a\n  10. []');
    expect(show('- [x] done', continueList('- [x] done', 10)!)).toBe('- [x] done\n- [ ] []');
    expect(show('> q', continueList('> q', 3)!)).toBe('> q\n> []');
  });
  it('ends the list on an empty item', () => {
    expect(show('- a\n- ', continueList('- a\n- ', 6)!)).toBe('- a\n[]');
  });
  it('ignores ordinary lines and the cursor inside the marker', () => {
    expect(continueList('hello', 5)).toBeNull();
    expect(continueList('- a', 1)).toBeNull();
  });
});

describe('renderBlocks', () => {
  it('renders GFM and tags each block with its source offset', () => {
    const src = '# Hi\n\n- [ ] task\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~';
    const { html, offsets } = renderBlocks(src);
    expect(html).toContain('<h1 data-b="0">Hi</h1>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<table data-b="2">');
    expect(html).toContain('<del>gone</del>');
    expect(offsets).toEqual([0, 6, 18, src.indexOf('~~')]);
  });
  it('keeps reference links working when rendering block by block', () => {
    expect(renderBlocks('[site][1]\n\n[1]: https://example.com').html).toContain('href="https://example.com"');
  });
});

describe('scroll sync', () => {
  it('interpolates between matching blocks', () => {
    const map = buildMap([100, 300], [50, 600], 500, 1000);
    expect(mapScroll(map, 0)).toBe(0);
    expect(mapScroll(map, 100)).toBe(50);
    expect(mapScroll(map, 200)).toBe(325);
    expect(mapScroll(map, 500)).toBe(1000);
    expect(mapScroll(map, 9999)).toBe(1000);
  });
  it('skips missing and out-of-order blocks', () => {
    const map = buildMap([100, NaN, 80, 200], [100, 150, 120, 400], 400, 800);
    expect(map.xs).toEqual([0, 100, 200, 400]);
    expect(mapScroll(map, 150)).toBe(250);
  });
  it('returns 0 when nothing scrolls', () => {
    expect(mapScroll(buildMap([], [], 0, 0), 10)).toBe(0);
  });
});

describe('export helpers', () => {
  it('finds the document title', () => {
    expect(docTitle('intro\n\n## **Trip** [notes](x.md)\n# Later')).toBe('Trip notes');
    expect(docTitle('no headings here')).toBe('');
    expect(docTitle('# Learn C#')).toBe('Learn C#');
    expect(docTitle('# Closed ##')).toBe('Closed');
  });
  it('makes safe file names', () => {
    expect(fileBase('Trip notes: Day 1!')).toBe('trip-notes-day-1');
    expect(fileBase('Café ☕ menu')).toBe('café-menu');
    expect(fileBase('')).toBe('document');
  });
  it('counts words', () => {
    expect(countWords("It's a well-known fact — 42 times.")).toBe(6);
  });
  it('escapes the title in standalone html', () => {
    const page = standaloneHtml('<script>', '<p>hi</p>');
    expect(page).toContain('<title>&lt;script&gt;</title>');
    expect(page).toContain('<p>hi</p>');
    expect(page.startsWith('<!doctype html>')).toBe(true);
  });
});

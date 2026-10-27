import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString } from 'pdf-lib';
import { getText, loadPdfjs, openPdf, textToString } from '@/engines/pdf/pdfjs';
import { breakLines, layoutDocument, longestWord, splitByFont, splitWord, type Atom, type Item, type Measure } from '@/tools/lib/md-pdf/layout';
import { allText, docTitle, fileBase, imageSources, type Block, type Run } from '@/tools/lib/md-pdf/model';
import { indentEdit } from '@/tools/lib/md-pdf/indent';
import { measurer, paintPdf, pdfUri } from '@/tools/lib/md-pdf/pdf';
import { printDocument } from '@/tools/lib/md-pdf/print';
import { tidy, safeHref } from '@/tools/lib/md-pdf/dom';
import { marginPt, type PageOptions } from '@/tools/lib/md-pdf/themes';

/** every character is half the font size wide */
const mono: Measure = (text) => [...text].length * 0.5;

const atom = (text: string, extra: Partial<Atom> = {}): Atom => ({
  text,
  font: 'sans-r',
  skew: false,
  size: 10,
  w: [...text].length * 5,
  color: '#000000',
  run: { text },
  ...extra,
});
const space = () => atom(' ', { space: true });
const words = (s: string) => s.split(' ').flatMap((w, k) => (k ? [space(), atom(w)] : [atom(w)]));
const lineText = (atoms: Atom[]) => atoms.map((a) => a.text).join('');

const opts: PageOptions = { theme: 'clean', size: 'A4', margin: 'normal', numbers: 'off' };
const p = (text: string): Block => ({ t: 'p', runs: [{ text }] });
const texts = (items: Item[]) => items.filter((i): i is Extract<Item, { k: 'text' }> => i.k === 'text');

describe('breakLines', () => {
  it('fills lines greedily and drops spaces at line ends', () => {
    // each letter is 5pt; 50pt fits 10 characters
    const lines = breakLines(words('aaa bbb ccc ddd'), 50, mono);
    expect(lines.map((l) => lineText(l.atoms))).toEqual(['aaa bbb', 'ccc ddd']);
    expect(lines[0].w).toBe(35);
  });

  it('never breaks between glued atoms, like **bold**text', () => {
    const glued = [atom('aaaa'), space(), atom('bbb'), atom('cc', { join: true })];
    expect(breakLines(glued, 30, mono).map((l) => lineText(l.atoms))).toEqual(['aaaa', 'bbbcc']);
  });

  it('splits a word wider than the line between characters', () => {
    const lines = breakLines([atom('abcdefghij')], 20, mono);
    expect(lines.map((l) => lineText(l.atoms))).toEqual(['abcd', 'efgh', 'ij']);
    expect(lines.every((l) => l.w <= 20)).toBe(true);
  });

  it('keeps going on the last piece of a split word', () => {
    const lines = breakLines([atom('abcdef'), space(), atom('g')], 20, mono);
    expect(lines.map((l) => lineText(l.atoms))).toEqual(['abcd', 'ef g']);
  });

  it('honors forced breaks and keeps empty lines between two breaks', () => {
    const br = atom('', { br: true, w: 0 });
    expect(breakLines([atom('a'), br, br, atom('b')], 100, mono).map((l) => lineText(l.atoms))).toEqual(['a', '', 'b']);
  });

  it('returns one empty line for no content', () => {
    expect(breakLines([], 100, mono)).toEqual([{ atoms: [], w: 0 }]);
  });
});

describe('word helpers', () => {
  it('splitWord puts at least one character on each piece', () => {
    expect(splitWord([atom('abc')], 1, mono).map(lineText)).toEqual(['a', 'b', 'c']);
  });
  it('longestWord measures glued runs', () => {
    expect(longestWord([atom('ab'), atom('cd', { join: true }), space(), atom('efg')])).toBe(20);
  });
  it('splitByFont separates text the standard fonts can and cannot draw', () => {
    expect(splitByFont('ab Ωμ cd')).toEqual(['ab ', 'Ωμ', ' cd']);
  });
});

describe('layoutDocument', () => {
  const margin = marginPt('normal');
  const right = 595.28 - margin;

  it('wraps text inside the margins and wraps after hyphens', () => {
    const long = 'state-of-the-art '.repeat(40);
    const { pages } = layoutDocument([p(long)], opts, mono);
    const items = texts(pages[0].items);
    expect(items.length).toBeGreaterThan(3);
    for (const it of items) {
      expect(it.x).toBeGreaterThanOrEqual(margin - 0.01);
      expect(it.x + it.w).toBeLessThanOrEqual(right + 0.01);
    }
    // some line ends right after a hyphen, inside a word
    expect(items.some((it) => /\w-$/.test(it.text))).toBe(true);
  });

  it('paginates without spilling past the bottom margin', () => {
    const blocks = Array.from({ length: 120 }, (_, k) => p(`Paragraph ${k} `.repeat(12)));
    const { pages, height } = layoutDocument(blocks, opts, mono);
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages) for (const it of texts(page.items)) expect(it.y).toBeLessThanOrEqual(height - margin);
    // every paragraph made it, in order
    const all = pages.flatMap((pg) => texts(pg.items).map((t) => t.text)).join(' ');
    expect(all.indexOf('Paragraph 119')).toBeGreaterThan(all.indexOf('Paragraph 0'));
  });

  it('moves a heading at the bottom of a page to the next one, with its paragraph', () => {
    // fill the page almost to the end with one-line paragraphs, then a heading
    const filler = Array.from({ length: 200 }, () => p('x'));
    const probe = layoutDocument(filler, opts, mono);
    const perPage = texts(probe.pages[0].items).length;
    const blocks: Block[] = [...filler.slice(0, perPage - 1), { t: 'h', level: 2, runs: [{ text: 'Heading' }] }, p('After the heading')];
    const { pages } = layoutDocument(blocks, opts, mono);
    expect(texts(pages[0].items).some((t) => t.text === 'Heading')).toBe(false);
    expect(texts(pages[1].items)[0].text).toBe('Heading');
  });

  it('never leaves one line of a paragraph alone at the bottom of a page', () => {
    const filler = Array.from({ length: 200 }, () => p('x'));
    const probe = layoutDocument(filler, opts, mono);
    const perPage = texts(probe.pages[0].items).length;
    // a 3-line paragraph starting on the last line slot
    const blocks: Block[] = [...filler.slice(0, perPage - 1), p('word '.repeat(250))];
    const { pages } = layoutDocument(blocks, opts, mono);
    expect(texts(pages[0].items).every((t) => t.text === 'x')).toBe(true);
  });

  it('draws a code block background on each page it spans', () => {
    const code = Array.from({ length: 140 }, (_, k) => `line ${k}`).join('\n');
    const { pages } = layoutDocument([{ t: 'code', text: code }], opts, mono);
    expect(pages.length).toBe(3);
    for (const page of pages) expect(page.items[0]).toMatchObject({ k: 'rect', fill: '#f6f8fa' });
    // leading whitespace in code is kept
    const indented = layoutDocument([{ t: 'code', text: '    indented' }], opts, mono);
    expect(texts(indented.pages[0].items)[0].text).toBe('    indented');
  });

  it('repeats a table header on each new page', () => {
    const cell = (text: string): Run[] => [{ text }];
    const rows = Array.from({ length: 90 }, (_, k) => [cell(`row ${k}`), cell(String(k * 3))]);
    const { pages } = layoutDocument([{ t: 'table', align: ['left', 'right'], head: [cell('Name'), cell('Value')], rows }], opts, mono);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(texts(page.items)[0].text).toBe('Name');
  });

  it('right-aligns table cells and fits the table to the page', () => {
    const rows = [[[{ text: 'a' }], [{ text: '42' }]]];
    const { pages } = layoutDocument([{ t: 'table', align: ['left', 'right'], head: null, rows }], opts, mono);
    const [a, n] = texts(pages[0].items);
    expect(a.text).toBe('a');
    expect(n.text).toBe('42');
    const wide = [[[{ text: 'word '.repeat(200) }], [{ text: 'word '.repeat(200) }]]];
    for (const it of texts(layoutDocument([{ t: 'table', align: [], head: null, rows: wide }], opts, mono).pages[0].items)) {
      expect(it.x + it.w).toBeLessThanOrEqual(right + 0.01);
    }
  });

  it('turns links into link areas and underlines', () => {
    const { pages } = layoutDocument([{ t: 'p', runs: [{ text: 'See ' }, { text: 'the docs', href: 'https://example.com' }, { text: '.' }] }], opts, mono);
    const link = pages[0].items.find((i) => i.k === 'link');
    expect(link).toMatchObject({ href: 'https://example.com' });
    expect(pages[0].items.some((i) => i.k === 'line')).toBe(true);
  });

  it('uses Noto for text the standard fonts cannot draw, slanted for italics', () => {
    const { pages } = layoutDocument([{ t: 'p', runs: [{ text: 'Hello ' }, { text: 'Привет', i: true }] }], opts, mono);
    const [hello, privet] = texts(pages[0].items);
    expect(hello.font).toBe('sans-r');
    expect(privet).toMatchObject({ font: 'noto-r', skew: true });
  });

  it('marks list items and task boxes', () => {
    const list: Block = {
      t: 'list',
      ordered: true,
      start: 3,
      items: [{ blocks: [{ t: 'p', runs: [{ text: 'three' }], tight: true }] }, { blocks: [{ t: 'p', runs: [{ text: 'four' }], tight: true }] }],
    };
    const labels = texts(layoutDocument([list], opts, mono).pages[0].items).map((t) => t.text);
    expect(labels).toEqual(['3.', 'three', '4.', 'four']);
    const tasks: Block = { t: 'list', ordered: false, start: 1, items: [{ task: 'done', blocks: [p('done')] }] };
    expect(layoutDocument([tasks], opts, mono).pages[0].items.some((i) => i.k === 'rect' && i.fill)).toBe(true);
  });

  it('scales images to fit and shows a placeholder when one is missing', () => {
    const img: Block = { t: 'img', src: 'https://example.com/a.png', alt: 'A chart' };
    const big = layoutDocument([img], opts, mono, { 'https://example.com/a.png': { w: 4000, h: 2000 } });
    const drawn = big.pages[0].items.find((i) => i.k === 'img')!;
    expect(drawn.k === 'img' && Math.round(drawn.w)).toBe(Math.round(595.28 - 2 * margin));
    const missing = layoutDocument([img], opts, mono);
    expect(texts(missing.pages[0].items)[0].text).toBe('Image: A chart');
  });

  it('handles lists and tables longer than a function call can take arguments', () => {
    const items = Array.from({ length: 200_000 }, (_, k) => ({ blocks: [{ t: 'p' as const, runs: [{ text: String(k) }], tight: true }] }));
    expect(layoutDocument([{ t: 'list', ordered: true, start: 1, items }], opts, mono).pages.length).toBeGreaterThan(1000);
  });

  it('adds page numbers', () => {
    const blocks = Array.from({ length: 150 }, () => p('Some text here'));
    const { pages } = layoutDocument(blocks, { ...opts, numbers: 'bottom-total' }, mono);
    const last = texts(pages.at(-1)!.items).at(-1)!;
    expect(last.text).toBe(`${pages.length} of ${pages.length}`);
  });
});

describe('model helpers', () => {
  const blocks: Block[] = [
    { t: 'quote', blocks: [{ t: 'h', level: 1, runs: [{ text: 'Trip ' }, { text: 'notes', b: true }] }] },
    { t: 'p', runs: [{ text: '', img: { src: 'a.png', alt: 'Ω' } }] },
    { t: 'img', src: 'a.png', alt: '' },
    { t: 'code', text: 'let x' },
  ];
  it('finds the title, images and all text', () => {
    expect(docTitle(blocks)).toBe('Trip notes');
    expect(imageSources(blocks)).toEqual(['a.png']);
    expect(allText(blocks)).toContain('Ω');
    expect(allText(blocks)).toContain('let x');
  });
  it('makes safe file names', () => {
    expect(fileBase('Trip notes: Day 1')).toBe('trip-notes-day-1');
    expect(fileBase('!!!')).toBe('document');
  });
});

describe('dom helpers', () => {
  it('collapses spaces across runs and trims line ends', () => {
    const runs = tidy([{ text: ' Hello ' }, { text: ' world', b: true }, { text: ' ' }, { text: '', br: true }, { text: ' next ' }, { text: '', br: true }]);
    expect(runs).toEqual([{ text: 'Hello ' }, { text: 'world', b: true }, { text: '', br: true }, { text: 'next' }]);
  });
  it('keeps only links that work in a PDF', () => {
    expect(safeHref(' https://a.com ')).toBe('https://a.com');
    expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeHref('#intro')).toBeUndefined();
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
  });
});

describe('indentEdit', () => {
  it('inserts two spaces at the caret', () => {
    expect(indentEdit('ab', 1, 1, false)).toEqual({ from: 1, to: 1, insert: '  ', selStart: 3, selEnd: 3 });
  });
  it('indents and outdents every selected line, skipping blank ones', () => {
    const text = 'a\n\nb\nc';
    const e = indentEdit(text, 0, 4, false);
    expect(e.insert).toBe('  a\n\n  b');
    expect(indentEdit('  a\n b\nc', 0, 6, true).insert).toBe('a\nb');
  });
  it('moves the caret back with its line on outdent', () => {
    expect(indentEdit('x\n    item', 8, 8, true)).toEqual({ from: 2, to: 10, insert: '  item', selStart: 6, selEnd: 6 });
  });
});

describe('printDocument', () => {
  it('sets the page size, margins and page numbers, and escapes the title', () => {
    const html = printDocument('<p>Hi</p>', { theme: 'editorial', size: 'Letter', margin: 'wide', numbers: 'bottom-total' }, 'A <b> & C');
    expect(html).toContain('@page{size:letter;margin:30mm;@bottom-center{content:counter(page) " of " counter(pages)');
    expect(html).toContain('<title>A &lt;b&gt; &amp; C</title>');
    expect(html).toContain('<body>\n<p>Hi</p>');
  });
  it("doesn't let the page's own CSS close its style element", () => {
    const html = printDocument('', opts, 't', 'p{color:red}</style><script>alert(1)</script>');
    expect(html).not.toContain('</style><script>');
  });
});

describe('pdf output', () => {
  it('builds a real PDF with the standard fonts, pages and link annotations', async () => {
    const measure = await measurer(false);
    const blocks: Block[] = [
      { t: 'h', level: 1, runs: [{ text: 'Report' }] },
      ...Array.from({ length: 60 }, (_, k): Block => ({ t: 'p', runs: [{ text: `Line ${k} with ` }, { text: 'a link', href: 'https://example.com' }, { text: ' and some more words to wrap.' }] })),
      { t: 'code', text: 'const x = 1;' },
      { t: 'table', align: ['left'], head: [[{ text: 'Head' }]], rows: [[[{ text: 'Cell' }]]] },
    ];
    const layout = layoutDocument(blocks, { ...opts, numbers: 'bottom' }, measure);
    const blob = await paintPdf(layout, {}, 'Report');
    const doc = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(doc.getPageCount()).toBe(layout.pages.length);
    expect(doc.getTitle()).toBe('Report');
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const first = annots.lookup(0, PDFDict);
    expect(first.lookup(PDFName.of('Subtype'))).toEqual(PDFName.of('Link'));
  });

  it('writes link targets that keep the file valid: parentheses, backslashes, non-ASCII', async () => {
    const hrefs = ['https://en.wikipedia.org/wiki/Foo_(bar', 'https://ru.wikipedia.org/wiki/Привет', 'mailto:a' + String.fromCharCode(92) + 'b)c@d.co', 'https://ok.com/after'];
    expect(pdfUri(hrefs[1])).toBe('https://ru.wikipedia.org/wiki/%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82');
    const measure = await measurer(false);
    const layout = layoutDocument([{ t: 'p', runs: hrefs.flatMap((href) => [{ text: 'link', href }, { text: ' and ' }]) }], opts, measure);
    const doc = await PDFDocument.load(new Uint8Array(await (await paintPdf(layout, {}, 'Links')).arrayBuffer()));
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    const uris = Array.from({ length: annots.size() }, (_, k) => annots.lookup(k, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString).decodeText());
    expect(uris).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar', pdfUri(hrefs[1]), hrefs[2], 'https://ok.com/after']);
  });

  it('writes real, extractable text, including Cyrillic in the embedded Noto Sans', async () => {
    // the Unicode font is normally fetched from /fonts/pdf/
    vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(`public${url}`)));
    vi.stubGlobal('location', { href: 'http://localhost/' });
    const lib = await loadPdfjs();
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').href;

    const blocks: Block[] = [
      { t: 'h', level: 1, runs: [{ text: 'Quarterly notes' }] },
      { t: 'p', runs: [{ text: 'Hello ' }, { text: 'Привет', i: true }, { text: ' and ' }, { text: 'bold', b: true }] },
    ];
    const measure = await measurer(true);
    const blob = await paintPdf(layoutDocument(blocks, opts, measure), {}, 'Quarterly notes');
    const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()));
    const text = textToString((await getText(pdf, 0)).items);
    await pdf.destroy();
    vi.unstubAllGlobals();
    expect(text).toContain('Quarterly notes');
    expect(text).toContain('Привет');
    expect(text).toContain('bold');
  });
});

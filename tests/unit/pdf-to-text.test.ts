import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { loadPdfjs, openPdf } from '@/engines/pdf';
import { layoutPage, type RawItem } from '@/tools/lib/pdf-text/layout';
import { stats, toMarkdown, toText, unwrap } from '@/tools/lib/pdf-text/format';
import { readPage } from '@/tools/lib/pdf-text/read';
import { encodePng, PNG_GRAY } from '@/tools/lib/pdf-images/png';

/** a horizontal item at (x, y) in PDF space (y up), roughly Helvetica-wide */
const item = (str: string, x: number, y: number, size = 10, width = str.length * size * 0.5): RawItem => ({ str, transform: [size, 0, 0, size, x, y], width });
const text = (items: RawItem[]) => layoutPage(items).map((p) => p.join('\n')).join('\n\n');

describe('layoutPage', () => {
  it('orders lines top to bottom and adds spaces at word gaps only', () => {
    const items = [item('second line', 50, 688), item('Hello', 50, 700), item('world', 80, 700), item('C', 110, 700), item('at', 115, 700)];
    expect(text(items)).toBe('Hello world Cat\nsecond line');
  });

  it('keeps text already spaced as is', () => {
    expect(text([item('Hello ', 50, 700, 10, 30), item('there', 80, 700)])).toBe('Hello there');
  });

  it('splits paragraphs at wider vertical gaps', () => {
    const items = [item('First paragraph line one', 50, 700), item('line two', 50, 688), item('Second paragraph', 50, 660), item('continues', 50, 648)];
    expect(layoutPage(items)).toEqual([['First paragraph line one', 'line two'], ['Second paragraph', 'continues']]);
  });

  it('starts a paragraph at a first-line indent and at a heading', () => {
    const items = [
      item('A Heading', 50, 730, 16),
      item('Body text that runs the full width', 50, 710),
      item('and wraps to here.', 50, 698),
      item('Indented new paragraph begins', 70, 686),
      item('and carries on.', 50, 674),
    ];
    expect(layoutPage(items)).toEqual([['A Heading'], ['Body text that runs the full width', 'and wraps to here.'], ['Indented new paragraph begins', 'and carries on.']]);
  });

  it('reads two columns one after the other, even with a title across both', () => {
    const items = [item('A title that spans both of the columns below', 50, 760, 14)];
    for (let i = 0; i < 5; i++) {
      items.push(item(`Left column line number ${i + 1}`, 50, 720 - i * 12));
      items.push(item(`Right column line number ${i + 1}`, 320, 720 - i * 12));
    }
    const out = text(items);
    expect(out.indexOf('A title')).toBe(0);
    expect(out.indexOf('Left column line number 5')).toBeLessThan(out.indexOf('Right column line number 1'));
    expect(out).not.toMatch(/Left[^\n]*Right/);
  });

  it('keeps table rows together, cells separated by tabs', () => {
    const items: RawItem[] = [];
    ['Name', 'Ana', 'Ben', 'Cy'].forEach((s, i) => items.push(item(s, 50, 700 - i * 14)));
    ['Score', '12', '7', '30'].forEach((s, i) => items.push(item(s, 250, 700 - i * 14)));
    expect(text(items)).toBe('Name\tScore\nAna\t12\nBen\t7\nCy\t30');
  });

  it('joins superscripts and drops text drawn twice for fake bold', () => {
    const items = [item('E = mc', 50, 700), item('2', 80, 704, 6), item('Bold', 50, 680), item('Bold', 50.3, 680)];
    expect(text(items)).toBe('E = mc2\nBold');
  });

  it('reads rotated text and puts margin notes after the main text', () => {
    // a page whose text runs bottom to top (90°)
    const rot = (str: string, x: number, y: number): RawItem => ({ str, transform: [0, 10, -10, 0, x, y], width: str.length * 5 });
    expect(text([rot('line two', 112, 50), rot('line one', 100, 50)])).toBe('line one\nline two');
    const mixed = [item('Main body text here', 50, 700), item('more body', 50, 688), rot('margin', 20, 400)];
    expect(text(mixed)).toBe('Main body text here\nmore body\n\nmargin');
  });

  it('handles a dense page drawn one character at a time', () => {
    const items: RawItem[] = [];
    const line = 'The quick brown fox jumps over the lazy dog again';
    for (let row = 0; row < 60; row++) {
      for (const x0 of [40, 310]) {
        [...line].forEach((ch, i) => ch !== ' ' && items.push(item(ch, x0 + i * 5, 780 - row * 12, 10, 5)));
      }
    }
    const started = performance.now();
    const out = layoutPage(items);
    expect(performance.now() - started).toBeLessThan(1500);
    const lines = out.flat();
    expect(lines).toHaveLength(120);
    expect(lines.every((l) => l === line)).toBe(true);
  });

  it('returns nothing for blank or whitespace-only pages', () => {
    expect(layoutPage([])).toEqual([]);
    expect(layoutPage([item('  ', 50, 700)])).toEqual([]);
  });
});

describe('formatting', () => {
  const pages = [[['Line one', 'wraps here with a hyphen-', 'ated word.'], ['Second para.']], null, [['# not a heading', '1. not a list']]];

  it('unwraps lines and mends hyphenation, keeping real hyphens', () => {
    expect(unwrap(['a hyphen-', 'ated word'])).toBe('a hyphenated word');
    expect(unwrap(['well-', 'Known'])).toBe('well- Known');
    expect(unwrap(['soft­', 'hyphen'])).toBe('softhyphen');
  });

  it('writes plain text with optional page markers', () => {
    expect(toText(pages, { markers: false, join: false })).toBe('Line one\nwraps here with a hyphen-\nated word.\n\nSecond para.\n\n# not a heading\n1. not a list\n');
    const marked = toText(pages, { markers: true, join: true });
    expect(marked).toContain('----- Page 1 -----\n\nLine one wraps here with a hyphenated word.');
    expect(marked).toContain('----- Page 2 -----\n\n[no text on this page]');
  });

  it('writes Markdown with page headings and escapes accidental syntax', () => {
    const md = toMarkdown(pages, { markers: true, title: 'Report' });
    expect(md.startsWith('# Report\n\n## Page 1\n\nLine one wraps')).toBe(true);
    expect(md).toContain('## Page 2\n\n*No text on this page.*');
    expect(md).toContain('\\# not a heading 1. not a list');
  });

  it('keeps table rows apart when joining lines, and writes them as a Markdown table', () => {
    const table = [[['Name\tScore', 'Ana\t12', 'B|n\t7'], ['Some prose that', 'wraps.']]];
    expect(toText(table, { markers: false, join: true })).toBe('Name\tScore\nAna\t12\nB|n\t7\n\nSome prose that wraps.\n');
    expect(toMarkdown(table, { markers: false })).toBe('| Name | Score |\n| --- | --- |\n| Ana | 12 |\n| B\\|n | 7 |\n\nSome prose that wraps.\n');
  });

  it('counts words', () => {
    expect(stats("It's a well-known fact, 42 times.").words).toBe(6);
  });
});

describe('readPage (pdf.js)', () => {
  beforeAll(async () => {
    vi.stubGlobal('location', { href: 'http://localhost/' });
    const lib = await loadPdfjs();
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').href;
  });

  it('extracts a real two-column page in reading order', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([595, 842]);
    page.drawText('Quarterly report', { x: 50, y: 790, size: 20, font });
    for (let i = 0; i < 6; i++) {
      page.drawText(`Left column sentence ${i + 1} goes here`, { x: 50, y: 740 - i * 14, size: 10, font });
      page.drawText(`Right column sentence ${i + 1} goes here`, { x: 310, y: 740 - i * 14, size: 10, font });
    }
    page.drawText('sideways', { x: 570, y: 300, size: 10, font, rotate: degrees(90) });
    const doc = await openPdf(await pdf.save());
    const { paragraphs, scanned } = await readPage(doc, 0);
    const out = paragraphs!.map((p) => p.join('\n')).join('\n\n');
    expect(scanned).toBe(false);
    expect(out).toBe(
      ['Quarterly report', [1, 2, 3, 4, 5, 6].map((n) => `Left column sentence ${n} goes here`).join('\n'), [1, 2, 3, 4, 5, 6].map((n) => `Right column sentence ${n} goes here`).join('\n'), 'sideways'].join('\n\n'),
    );
    await doc.destroy();
  });

  it('flags image-only pages as scanned, blank pages as not', async () => {
    const doc = await openPdf(new Uint8Array(readFileSync('tests/fixtures/pdf/sample-images.pdf')));
    expect((await readPage(doc, 0)).paragraphs).not.toBeNull();
    await doc.destroy();

    // a page that only paints an image, plus a blank one
    const pdf = await PDFDocument.create();
    const png = await pdf.embedPng(encodePng({ width: 4, height: 4, colorType: PNG_GRAY, depth: 8, data: new Uint8Array(16).fill(128) }));
    pdf.addPage([200, 200]).drawImage(png, { x: 0, y: 0, width: 200, height: 200 });
    pdf.addPage([200, 200]);
    const scan = await openPdf(await pdf.save());
    expect(await readPage(scan, 0)).toEqual({ paragraphs: null, scanned: true });
    expect(await readPage(scan, 1)).toEqual({ paragraphs: null, scanned: false });
    await scan.destroy();
  });
});

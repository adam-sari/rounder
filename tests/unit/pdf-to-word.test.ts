import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPdfjs, openPdf } from '@/engines/pdf';
import { buildDocx, docxBytes } from '@/tools/lib/office/docx';
import { assignHeadings, buildPage, findTables, joinRuns, lineRuns, listMarker, type PageModel, type Run, type StyledItem } from '@/tools/lib/office/model';
import { charColors, fontFamily, mergeRects, ocrInput, readPageInput, splitItem } from '@/tools/lib/office/pdf-read';
import { pageLines } from '@/tools/lib/pdf-text/layout';

/** an upright item at (x, y) in PDF space (y up), roughly Helvetica-wide */
const item = (str: string, x: number, y: number, o: Partial<StyledItem> & { size?: number } = {}): StyledItem => {
  const size = o.size ?? 10;
  return { str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, font: 'Arial', bold: false, italic: false, ...o };
};
const run = (text: string, o: Partial<Run> = {}): Run => ({ text, bold: false, italic: false, size: 10, font: 'Arial', ...o });
const page = (items: StyledItem[], pictures = [] as PageModel['area'][]) => buildPage({ width: 612, height: 792, items, pictures });
const texts = (m: PageModel) => m.blocks.map((b) => (b.kind === 'paragraph' ? b.runs.map((r) => r.text).join('') : b.kind));

describe('PDF fonts and colors', () => {
  it('turns PostScript names into the families Word knows', () => {
    expect(fontFamily('ABCDEF+TimesNewRomanPS-BoldItalicMT')).toBe('Times New Roman');
    expect(fontFamily('ArialMT')).toBe('Arial');
    expect(fontFamily('Helvetica-Bold')).toBe('Arial');
    expect(fontFamily('BCDEEE+Calibri-Light')).toBe('Calibri');
    expect(fontFamily('SegoeUI-Semibold')).toBe('Segoe UI');
    expect(fontFamily('', 'serif')).toBe('Times New Roman');
    expect(fontFamily('g_d0_f1', 'monospace')).toBe('Courier New');
  });

  it('matches each letter to the color it was drawn in, ignoring near-black', () => {
    const drawn = [...'Hi'].map((ch) => ({ ch, color: '#000000' })).concat([...'there'].map((ch) => ({ ch, color: '#c00000' })));
    expect(charColors([{ str: 'Hi there' }], drawn)).toEqual([[undefined, undefined, undefined, '#c00000', '#c00000', '#c00000', '#c00000', '#c00000']]);
  });

  it('colors the letter s like any other letter and splits only at real color changes', () => {
    const drawn = [...'See'].map((ch) => ({ ch, color: '#000000' })).concat([...'sales'].map((ch) => ({ ch, color: '#0000ff' })));
    const colors = charColors([{ str: 'See sales' }], drawn)[0];
    expect(colors).toEqual([undefined, undefined, undefined, undefined, '#0000ff', '#0000ff', '#0000ff', '#0000ff', '#0000ff']);
    expect(splitItem(item('See sales', 100, 700), colors).map((p) => p.str)).toEqual(['See ', 'sales']);
  });

  it('splits an item where its color changes and at link edges', () => {
    const it0 = item('Visit example.com now', 100, 700);
    const colors = [...'Visit example.com now'].map((_, i) => (i >= 6 && i < 17 ? '#0000ff' : undefined));
    const parts = splitItem(it0, colors, [100 + 6 * 5 + 1, 100 + 17 * 5]);
    expect(parts.map((p) => p.str)).toEqual(['Visit ', 'example.com', ' now']);
    expect(parts.map((p) => p.color)).toEqual([undefined, '#0000ff', undefined]);
    expect(parts[1].transform[4]).toBeCloseTo(130);
  });

  it('merges pictures that touch', () => {
    const r = (x0: number, top: number, w: number, h: number) => ({ x0, x1: x0 + w, top, bottom: top + h });
    expect(mergeRects([r(0, 0, 10, 10), r(11, 0, 10, 10), r(100, 100, 10, 10)])).toHaveLength(2);
  });
});

describe('PDF page model', () => {
  it('spaces runs, keeps styles apart and marks superscripts', () => {
    const items = [item('E = mc', 50, 700), item('2', 80, 704, { size: 6 }), item(' and', 83, 700), item('bold', 108, 700, { bold: true })];
    const [line] = pageLines(items);
    const runs = lineRuns(line, items);
    expect(runs.map((r) => r.text)).toEqual(['E = mc', '2', ' and', ' bold']);
    expect(runs[1].sup).toBe(true);
    expect(runs[3].bold).toBe(true);
  });

  it('joins lines into a paragraph and mends hyphenation', () => {
    expect(joinRuns([[run('a hyphen-')], [run('ated word')]]).map((r) => r.text)).toEqual(['a hyphenated word']);
    expect(joinRuns([[run('line one')], [run('line two')]])[0].text).toBe('line one line two');
  });

  it('reads bullets and numbers but leaves hyphenated words alone', () => {
    const b = [run('• Apples')];
    expect(listMarker(b)).toMatchObject({ type: 'bullet' });
    expect(b[0].text).toBe('Apples');
    const n = [run('12. Pears')];
    expect(listMarker(n)).toMatchObject({ type: 'number', start: 12, marker: '12. ' });
    expect(listMarker([run('-based pricing')])).toBeUndefined();
    expect(listMarker([run('2026 was good')])).toBeUndefined();
  });

  it('finds a table whose cells line up, with right-aligned numbers and a bold header', () => {
    const items: StyledItem[] = [];
    const rows = [['Item', 'Qty', 'Price'], ['Coffee beans', '2', '1,250.00'], ['Filters', '10', '4.50'], ['Mug', '1', '12.00']];
    rows.forEach((r, i) => {
      const y = 700 - i * 16;
      items.push(item(r[0], 50, y, { bold: i === 0 }), item(r[1], 250, y, { bold: i === 0 }));
      // right-aligned at x = 420
      items.push(item(r[2], 420 - r[2].length * 5, y, { bold: i === 0 }));
    });
    const [t] = findTables(pageLines(items), items);
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual(rows);
    expect(t.header).toBe(true);
    expect(t.widths).toHaveLength(3);
  });

  it('joins a wrapped cell to its row', () => {
    const items: StyledItem[] = [];
    const add = (cells: [string, number][], y: number) => cells.forEach(([s, x]) => items.push(item(s, x, y)));
    add([['Name', 50], ['Notes', 200], ['Total', 400]], 700);
    add([['Ana', 50], ['First visit,', 200], ['30', 400]], 680);
    add([['paid cash', 200]], 669);
    add([['Ben', 50], ['Repeat', 200], ['12', 400]], 649);
    const [t] = findTables(pageLines(items), items);
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual([['Name', 'Notes', 'Total'], ['Ana', 'First visit, paid cash', '30'], ['Ben', 'Repeat', '12']]);
  });

  it("doesn't take two columns of prose for a table", () => {
    const items: StyledItem[] = [];
    for (let i = 0; i < 6; i++) {
      items.push(item('Left column text that reads like a sentence', 50, 700 - i * 12));
      items.push(item('Right column text that also reads on and on', 320, 700 - i * 12));
    }
    expect(findTables(pageLines(items), items)).toEqual([]);
    expect(texts(page(items))).toHaveLength(2);
  });

  it('splits list items, finds headings and centers titles', () => {
    const items = [
      item('Big Title', 143.5, 740, { size: 24, bold: true }),
      item('Intro text that is long enough to be body copy and runs on.', 50, 700),
      item('Points', 50, 680, { bold: true }),
      item('• First point', 60, 664),
      item('• Second point', 60, 652),
      item('◦ Nested point', 80, 640),
    ];
    const m = page(items);
    assignHeadings([m]);
    const [title, , points, ...list] = m.blocks.map((b) => (b.kind === 'paragraph' ? b : null)!);
    expect(title).toMatchObject({ heading: 1, align: 'center', indent: 0 });
    expect(points.heading).toBe(2);
    expect(list.map((p) => [p.runs[0].text, p.list?.level])).toEqual([['First point', 0], ['Second point', 0], ['Nested point', 1]]);
  });

  it('keeps a big numbered line as a heading with its number', () => {
    const m = page([item('2. Results', 50, 740, { size: 16, bold: true }), item('Body text goes here and is long enough to count as body.', 50, 715)]);
    assignHeadings([m]);
    expect(m.blocks[0]).toMatchObject({ heading: 1, list: undefined });
    expect(texts(m)[0]).toBe('2. Results');
  });

  it('places a picture in the flow and drops the text drawn inside it', () => {
    const items = [item('Above the chart.', 50, 700), item('label', 120, 600), item('Below the chart.', 50, 500)];
    const m = page(items, [{ x0: 100, x1: 300, top: -650, bottom: -550 }]);
    expect(texts(m)).toEqual(['Above the chart.', 'picture', 'Below the chart.']);
  });

  it('ignores a page-sized background picture with text on it (a scan with OCR)', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`Line ${i} of recognized text`, 50, 700 - i * 14));
    const m = page(items, [{ x0: 0, x1: 612, top: -792, bottom: 0 }]);
    expect(m.blocks.every((b) => b.kind === 'paragraph')).toBe(true);
  });

  it('turns OCR words into items at their size and place', () => {
    const word = (text: string, x0: number, x1: number) => ({ text, bbox: { x0, y0: 100, x1, y1: 150 } });
    const line = { bbox: { x0: 100, y0: 100, x1: 600, y1: 150 }, baseline: { x0: 100, y0: 140, x1: 600, y1: 140 }, rowAttributes: { row_height: 50 }, words: [word('Hello', 100, 300), word('world', 330, 560)] };
    const input = ocrInput({ blocks: [{ paragraphs: [{ lines: [line] }] }] } as never, 300, 612, 792);
    expect(input.items.map((i) => i.str)).toEqual(['Hello', 'world']);
    expect(input.items[0].transform[4]).toBeCloseTo(24);
    expect(input.items[0].transform[5]).toBeCloseTo(792 - 140 * 0.24);
    expect(input.items[0].transform[0]).toBe(10.5);
  });
});

describe('PDF to Word (pdf.js + docx)', () => {
  beforeAll(async () => {
    vi.stubGlobal('location', { href: 'http://localhost/' });
    const lib = await loadPdfjs();
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').href;
  });

  const models = async (name: string) => {
    const doc = await openPdf(new Uint8Array(readFileSync(`tests/fixtures/office/${name}`)));
    const pages: PageModel[] = [];
    for (let i = 0; i < doc.numPages; i++) pages.push(buildPage((await readPageInput(doc, i)).input));
    await doc.destroy();
    assignHeadings(pages);
    return pages;
  };

  it('reads the report: headings, lists, table, picture, link and both columns in order', async () => {
    const pages = await models('report.pdf');
    const flat = pages.flatMap((p) => p.blocks);
    const para = (text: string) => flat.find((b) => b.kind === 'paragraph' && b.runs.map((r) => r.text).join('').startsWith(text));
    expect(para('Annual Report 2026')).toMatchObject({ heading: 1, align: 'center' });
    expect(para('1. Summary')).toMatchObject({ heading: 2 });
    expect(para('Highlights')).toMatchObject({ heading: 3 });
    expect(para('Lisbon')).toMatchObject({ list: { type: 'bullet', level: 1 } });
    expect(para('Elect the audit')).toMatchObject({ list: { type: 'number', start: 2 } });
    expect(para('Quarterly revenue')).toMatchObject({ align: 'justify' });
    const table = flat.find((b) => b.kind === 'table');
    expect(table?.kind === 'table' && table.rows[2].map((c) => c.text)).toEqual(['Europe', '3,180,500', '+21%', '244']);
    expect(flat.filter((b) => b.kind === 'picture')).toHaveLength(1);
    const linkPara = para('Full figures');
    expect(linkPara?.kind === 'paragraph' && linkPara.runs.at(-1)).toMatchObject({ text: 'example.com/report', link: 'https://example.com/report', color: '#0545bf' });
    const order = pages[1].blocks.map((b) => (b.kind === 'paragraph' ? b.runs[0].text.slice(0, 12) : ''));
    expect(order.indexOf('Left column ')).toBeLessThan(order.indexOf('Right column'));
  });

  it('writes a .docx with Word headings, lists, a table, a picture, a link and page breaks', async () => {
    const pages = await models('report.pdf');
    const png = new Uint8Array(readFileSync('public/icons/apple-touch-icon.png'));
    const bytes = await docxBytes(buildDocx(pages, { title: 'report', pictures: pages.map((p) => p.blocks.flatMap((b) => (b.kind === 'picture' ? [{ data: png, type: 'png' as const }] : []))) }));
    const files = unzipSync(bytes);
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('Annual Report 2026');
    expect(xml.match(/<w:numPr>/g)?.length).toBe(7);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('<w:hyperlink');
    expect(xml).toContain('w:type="page"');
    expect(xml).toContain('w:color w:val="1f4f78"');
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('https://example.com/report');
    expect(Object.keys(files).some((f) => f.startsWith('word/media/'))).toBe(true);
  });
});

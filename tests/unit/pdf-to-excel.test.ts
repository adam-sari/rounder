import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPdfjs, openPdf } from '@/engines/pdf';
import { allTables, buildPage, pageGrid } from '@/tools/lib/office/model';
import { readPageInput } from '@/tools/lib/office/pdf-read';
import { buildPptx, fit, slideSize } from '@/tools/lib/office/pptx';
import { buildXlsx, guessDecimal, parseNumber } from '@/tools/lib/office/xlsx';

describe('numbers in cells', () => {
  it('reads amounts the way a spreadsheet should', () => {
    expect(parseNumber('1,234.50')).toEqual({ value: 1234.5, format: '#,##0.00' });
    expect(parseNumber('-4.75')).toEqual({ value: -4.75, format: '0.00' });
    expect(parseNumber('(80.00)')).toEqual({ value: -80, format: '0.00;(0.00)' });
    expect(parseNumber('$12')).toEqual({ value: 12, format: '"$"0' });
    expect(parseNumber('$1,200.00')?.value).toBe(1200);
    expect(parseNumber('-$3.10')?.value).toBe(-3.1);
    expect(parseNumber('12.5%')).toEqual({ value: 0.125, format: '0.0%' });
    expect(parseNumber('+21%')?.value).toBeCloseTo(0.21);
    expect(parseNumber('310')).toEqual({ value: 310, format: 'General' });
    expect(parseNumber('45.00-')?.value).toBe(-45);
  });

  it('leaves codes, dates and words as text', () => {
    for (const t of ['0042', '09/01', '2026-10-27', '1-800-555-0100', 'N/A', '1234567890123456', 'abc', '']) expect(parseNumber(t)).toBeNull();
  });

  it('handles a decimal comma', () => {
    expect(guessDecimal(['1.234,56', '12,50', 'total 3.100,00'])).toBe(',');
    expect(guessDecimal(['1,234.56', '12.50'])).toBe('.');
    expect(parseNumber('1.234,56', ',')).toEqual({ value: 1234.56, format: '#,##0.00' });
    expect(parseNumber('1,234.56', ',')).toBeNull();
  });
});

describe('PDF to Excel', () => {
  beforeAll(async () => {
    vi.stubGlobal('location', { href: 'http://localhost/' });
    const lib = await loadPdfjs();
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').href;
  });

  it('turns a statement into a sheet with real numbers', async () => {
    const doc = await openPdf(new Uint8Array(readFileSync('tests/fixtures/office/statement.pdf')));
    const { input } = await readPageInput(doc, 0);
    await doc.destroy();
    const model = buildPage(input);
    const [{ table }] = allTables([model]);
    expect(table.rows).toHaveLength(16);
    const wb = await buildXlsx([{ name: 'Table 1', rows: table.rows, header: table.header }]);
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());
    const ws = back.getWorksheet('Table 1')!;
    expect(ws.getCell('A1').value).toBe('Date');
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.getCell('A3').value).toBe('09/02');
    expect(ws.getCell('C3').value).toBe(-4.75);
    expect(ws.getCell('C4').value).toBe(3200);
    expect(ws.getCell('C4').numFmt).toBe('#,##0.00');
    expect(ws.getCell('D16').value).toBe(4414.12);
    // the whole page: the header lines, the table, the footer
    const grid = pageGrid(input, model);
    expect(grid[0]).toEqual(['Northwind Bank', 'Statement period: Sep 1 - Sep 30, 2026']);
    expect(grid.at(-1)).toEqual(['Questions? Call 1-800-555-0100 or visit your branch.']);
  });

  it('names sheets safely', async () => {
    const wb = await buildXlsx([{ name: 'Page 1: a/b', rows: [['x']] }, { name: 'page 1: a/b', rows: [['y']] }]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Page 1  a b', 'page 1  a b (2)']);
  });
});

describe('PDF to PowerPoint', () => {
  it('sizes slides to the page shape', () => {
    expect(slideSize(612, 792)).toEqual({ w: 10.303, h: 13.333 });
    expect(slideSize(792, 612)).toEqual({ w: 13.333, h: 10.303 });
    expect(fit({ width: 595, height: 842 }, { w: 13.333, h: 10.303 })).toMatchObject({ y: 0, h: 10.303 });
  });

  it('writes one picture slide per page with the text as notes', async () => {
    const png = new Uint8Array(readFileSync('public/icons/apple-touch-icon.png'));
    const blob = await buildPptx([
      { width: 792, height: 612, image: { data: png, type: 'png' }, notes: 'First page text' },
      { width: 792, height: 612, image: { data: png, type: 'png' } },
    ]);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))).toHaveLength(2);
    expect(Object.keys(files).filter((f) => /^ppt\/media\/.+\.png$/.test(f))).toHaveLength(2);
    expect(strFromU8(files['ppt/notesSlides/notesSlide1.xml'])).toContain('First page text');
  });
});

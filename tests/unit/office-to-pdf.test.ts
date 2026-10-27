import { describe, expect, it } from 'vitest';
import ssf from 'ssf';
import { cutAt, parseColor } from '@/tools/lib/office/dom-pdf';
import { familyFor, parseRange } from '@/tools/lib/office/fonts';
import { FORMATS, readError } from '@/tools/lib/office/formats';
import { guessFamily } from '@/tools/lib/office/pdf-read';
import ExcelJS from 'exceljs';
import { cellText, counterPairs, counterText, cssColor, evalContent, MAX_CELLS, renderXlsx } from '@/tools/lib/office/render';

const ZIP = new Uint8Array([0x50, 0x4b, 3, 4]);
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);

describe('Office files in', () => {
  it('accepts .docx/.xlsx/.pptx and explains old or locked files', () => {
    expect(readError('word', ZIP, 'report.docx')).toBeNull();
    expect(readError('word', OLE, 'report.docx')).toMatch(/older \.doc file or a password-protected one/);
    expect(readError('excel', ZIP, 'old.xls')).toMatch(/save it as \.xlsx/);
    expect(readError('powerpoint', new Uint8Array([1, 2, 3, 4]), 'deck.pptx')).toMatch(/doesn't look like a PowerPoint file/);
    for (const f of Object.values(FORMATS)) expect(Number(f.downloadMb)).toBeGreaterThan(0);
  });

  it('maps Office fonts to their metric-compatible stand-ins', () => {
    expect(familyFor('"Calibri Light", sans-serif')).toBe('carlito');
    expect(familyFor('Aptos')).toBe('carlito');
    expect(familyFor('Cambria Math, serif')).toBe('caladea');
    expect(familyFor("'Times New Roman'")).toBe('tinos');
    expect(familyFor('Consolas, monospace')).toBe('cousine');
    expect(familyFor('Helvetica Neue, Arial')).toBe('arimo');
    expect(familyFor('Some Display Font, serif')).toBe('tinos');
    expect(familyFor('Some Display Font')).toBe('arimo');
    expect(familyFor('rounder-caladea')).toBe('caladea');
  });

  it('reads unicode ranges', () => {
    expect(parseRange('U+0000-00FF,U+0131, U+2000-206F')).toEqual([[0, 255], [305, 305], [0x2000, 0x206f]]);
  });

  it('guesses a PDF font from how wide its letters are', () => {
    expect(guessFamily('sans-serif', 0.43, false)).toBe('Calibri');
    expect(guessFamily('sans-serif', 0.51, false)).toBe('Arial');
    expect(guessFamily('sans-serif', 0.48, true)).toBe('Calibri');
    expect(guessFamily('serif', 0.42, false)).toBe('Times New Roman');
    expect(guessFamily('serif', 0.48, false)).toBe('Cambria');
    expect(guessFamily('monospace', 0.6, false)).toBe('Courier New');
  });
});

describe('painting pages', () => {
  it('parses computed colors and skips transparent ones', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ color: [1, 0, 0], alpha: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ color: [0, 0, 0], alpha: 0.5 });
    expect(parseColor('rgb(0 128 255 / 25%)')?.alpha).toBe(0.25);
    expect(parseColor('rgba(0, 0, 0, 0)')).toBeNull();
    expect(parseColor('transparent')).toBeNull();
  });

  it('cuts long pages between lines, never through one', () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ y: 100 + i * 20, h: 16 }));
    const cut = cutAt(lines, 300, 1000);
    expect(cut).toBeLessThanOrEqual(1000);
    expect(lines.every((l) => cut <= l.y || cut >= l.y + l.h)).toBe(true);
    // a picture taller than the room left is cut through rather than looping
    expect(cutAt([{ y: 0, h: 5000 }], 300, 1000)).toBe(1000);
    // a free spot is taken as is
    expect(cutAt([{ y: 0, h: 10 }], 300, 1000)).toBe(1000);
  });
});

describe('Word list numbers', () => {
  it('writes counters the way CSS does', () => {
    expect([1, 2, 3].map((n) => counterText(n))).toEqual(['1', '2', '3']);
    expect(counterText(28, 'lower-alpha')).toBe('ab');
    expect(counterText(4, 'upper-roman')).toBe('IV');
    expect(counterText(1994, 'lower-roman')).toBe('mcmxciv');
    expect(counterText(7, 'decimal-leading-zero')).toBe('07');
  });

  it('reads counter properties and content', () => {
    expect(counterPairs('docx-num-1-0 0 docx-num-2-0 3', 0)).toEqual([['docx-num-1-0', 0], ['docx-num-2-0', 3]]);
    expect(counterPairs('docx-num-1-0', 1)).toEqual([['docx-num-1-0', 1]]);
    expect(counterPairs('none', 1)).toEqual([]);
    const counters = new Map([['docx-num-2-0', 3], ['docx-num-2-1', 2]]);
    expect(evalContent('"" counter(docx-num-2-0, decimal) "." counter(docx-num-2-1, lower-alpha) "\\9 "', counters)).toBe('3.b\t');
    expect(evalContent('"•\\9 "', counters)).toBe('•\t');
    expect(evalContent('none', counters)).toBe('');
  });
});

describe('Excel cells', () => {
  it('shows values through their number format', () => {
    expect(cellText({ value: 1234.5, numFmt: '$#,##0.00' }, ssf)).toEqual({ text: '$1,234.50', number: true });
    expect(cellText({ value: 0.125, numFmt: '0.0%' }, ssf).text).toBe('12.5%');
    expect(cellText({ value: new Date(Date.UTC(2026, 9, 27)), numFmt: 'mm/dd/yyyy' }, ssf).text).toBe('10/27/2026');
    expect(cellText({ value: { formula: 'A1*2', result: 42 }, numFmt: '0.00' } as never, ssf).text).toBe('42.00');
    expect(cellText({ value: { richText: [{ text: 'Bold ' }, { text: 'and plain' }] }, numFmt: '' } as never, ssf).text).toBe('Bold and plain');
    expect(cellText({ value: { text: 'Site', hyperlink: 'https://example.com' }, numFmt: '' } as never, ssf).text).toBe('Site');
    expect(cellText({ value: true, numFmt: '' }, ssf).text).toBe('TRUE');
    expect(cellText({ value: null, numFmt: '' }, ssf).text).toBe('');
  });

  it('resolves theme colors and tints', () => {
    expect(cssColor({ argb: 'FF1F4E79' })).toBe('#1F4E79');
    expect(cssColor({ theme: 4 })).toBe('#4472C4');
    expect(cssColor({ theme: 1, tint: 0.5 })).toBe('#808080');
    expect(cssColor({ theme: 0, tint: -0.5 })).toBe('#808080');
    expect(cssColor(undefined)).toBeUndefined();
  });

  it('turns a workbook too big to lay out away with a clear message, before touching the page', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Log');
    ws.getCell(MAX_CELLS / 4 + 1, 4).value = 'last';
    ws.getCell(1, 1).value = 'first';
    const opts = { paper: 'letter', orientation: 'auto', fitWidth: true, gridlines: false } as const;
    await expect(renderXlsx(wb, null as never, opts)).rejects.toThrow(/about 300,004 cells to print.*Pick fewer sheets/);
  });
});

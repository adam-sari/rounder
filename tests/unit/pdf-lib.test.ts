import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { DAMAGED, PdfError, PdfPasswordError, qpdfError } from '@/engines/pdf/errors';
import { assemblePdf, isWinAnsi, loadPdfLib, PAGE_SIZES, pdfName } from '@/engines/pdf/lib';
import type { PdfDoc } from '@/engines/pdf/pdfjs';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/pdf/${name}`));
const fakeDoc = (id: string) => ({ id }) as PdfDoc;

describe('pdfName', () => {
  it('swaps or adds the extension and suffix', () => {
    expect(pdfName('Report.PDF', '-merged')).toBe('Report-merged.pdf');
    expect(pdfName('scan', '-compressed')).toBe('scan-compressed.pdf');
    expect(pdfName('my.notes.pdf', '-pages-1-3')).toBe('my.notes-pages-1-3.pdf');
    expect(pdfName('', '-merged')).toBe('document-merged.pdf');
    expect(pdfName('slides.pdf', '-page-1', 'jpg')).toBe('slides-page-1.jpg');
  });
});

describe('isWinAnsi', () => {
  it('accepts what Helvetica can draw', () => {
    expect(isWinAnsi('Page 1 of 10')).toBe(true);
    expect(isWinAnsi('Café – “quoted” €5 ©\tTab\nnew line')).toBe(true);
  });
  it('rejects what needs the Unicode font', () => {
    expect(isWinAnsi('Zażółć')).toBe(false);
    expect(isWinAnsi('Привет')).toBe(false);
    expect(isWinAnsi('Ελληνικά')).toBe(false);
    expect(isWinAnsi('漢字')).toBe(false);
    expect(isWinAnsi('🙂')).toBe(false);
  });
});

describe('PAGE_SIZES', () => {
  it('are portrait points', () => {
    expect(PAGE_SIZES.Letter).toEqual([612, 792]);
    expect(PAGE_SIZES.A4[0]).toBeCloseTo((210 / 25.4) * 72, 1);
    for (const [w, h] of Object.values(PAGE_SIZES)) expect(w).toBeLessThan(h);
  });
});

describe('loadPdfLib', () => {
  it('loads a normal PDF', async () => {
    const doc = await loadPdfLib(fixture('sample-3-pages.pdf'));
    expect(doc.getPageCount()).toBe(3);
  });
  it('reports encryption as a password error', async () => {
    await expect(loadPdfLib(fixture('sample-encrypted.pdf'))).rejects.toBeInstanceOf(PdfPasswordError);
    await expect(loadPdfLib(fixture('sample-restricted.pdf'))).rejects.toMatchObject({ reason: 'needsPassword' });
  });
  it('reports junk as damaged', async () => {
    await expect(loadPdfLib(fixture('not-a-pdf.pdf'))).rejects.toMatchObject({ kind: 'damaged', message: DAMAGED });
  });
});

describe('assemblePdf', () => {
  it('reorders, rotates, repeats and mixes documents', async () => {
    const a = await loadPdfLib(fixture('sample-3-pages.pdf'));
    const b = await loadPdfLib(fixture('sample-mixed-sizes.pdf'));
    const out = await assemblePdf(
      [
        { doc: fakeDoc('a'), pageIndex: 2, rotation: 0 },
        { doc: fakeDoc('b'), pageIndex: 3, rotation: 90 }, // already /Rotate 90
        { doc: fakeDoc('a'), pageIndex: 0, rotation: 270 },
        { doc: fakeDoc('a'), pageIndex: 2, rotation: 0 },
      ],
      new Map([
        ['a', a],
        ['b', b],
      ]),
    );
    const reloaded = await PDFDocument.load(await out.save());
    const pages = reloaded.getPages();
    expect(pages).toHaveLength(4);
    expect(pages.map((p) => p.getRotation().angle)).toEqual([0, 180, 270, 0]);
    expect(pages[1].getSize().width).toBeCloseTo(PAGE_SIZES.A4[0], 1);
  });

  it('says so when a source is missing', async () => {
    await expect(assemblePdf([{ doc: fakeDoc('gone'), pageIndex: 0, rotation: 0 }], new Map())).rejects.toBeInstanceOf(PdfError);
  });
});

describe('qpdfError', () => {
  it('maps passwords', () => {
    expect(qpdfError('this.program: in.pdf: invalid password', false)).toMatchObject({ reason: 'needsPassword' });
    expect(qpdfError('this.program: in.pdf: invalid password', true)).toMatchObject({ reason: 'wrongPassword' });
  });
  it('maps damage', () => {
    expect(qpdfError("this.program: in.pdf: can't find startxref", false).kind).toBe('damaged');
  });
  it('keeps other messages readable', () => {
    expect(qpdfError('this.program: in.pdf (offset 10): unsupported thing', false).message).toBe("The PDF couldn't be processed (unsupported thing).");
  });
});

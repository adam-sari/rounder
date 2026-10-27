import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getPageSize, getText, loadPdfjs, openPdf, pageRefs, PdfError, PdfPasswordError, textToString } from '@/engines/pdf';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/pdf/${name}`));

beforeAll(async () => {
  // openPdf builds asset URLs from location; in node pdf.js runs its worker in-process
  vi.stubGlobal('location', { href: 'http://localhost/' });
  const lib = await loadPdfjs();
  lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs').href;
});

describe('openPdf', () => {
  it('opens a PDF and leaves the caller’s bytes usable', async () => {
    const bytes = fixture('sample-3-pages.pdf');
    const doc = await openPdf(bytes);
    expect(doc.numPages).toBe(3);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(pageRefs(doc).map((r) => r.id)).toEqual([`${doc.id}:0`, `${doc.id}:1`, `${doc.id}:2`]);
    await doc.destroy();
    expect(doc.destroyed).toBe(true);
  });

  it('tells a missing password from a wrong one', async () => {
    await expect(openPdf(fixture('sample-encrypted.pdf'))).rejects.toMatchObject({ reason: 'needsPassword' });
    await expect(openPdf(fixture('sample-encrypted.pdf'), { password: 'nope' })).rejects.toMatchObject({ reason: 'wrongPassword' });
    await expect(openPdf(fixture('sample-encrypted.pdf'), { password: 'nope' })).rejects.toBeInstanceOf(PdfPasswordError);
    const doc = await openPdf(fixture('sample-encrypted.pdf'), { password: 'rounder' });
    expect(doc.numPages).toBe(3);
    await doc.destroy();
  });

  it('opens permission-only encryption without a password', async () => {
    const doc = await openPdf(fixture('sample-restricted.pdf'));
    expect(doc.numPages).toBe(3);
    await doc.destroy();
  });

  it('calls broken files damaged', async () => {
    await expect(openPdf(fixture('not-a-pdf.pdf'))).rejects.toMatchObject({ kind: 'damaged' });
    await expect(openPdf(fixture('sample-damaged.pdf'))).rejects.toBeInstanceOf(PdfError);
  });
});

describe('getPageSize', () => {
  it('reports displayed size in points with /Rotate applied', async () => {
    const doc = await openPdf(fixture('sample-mixed-sizes.pdf'));
    const sizes = await Promise.all([0, 1, 2, 3].map((i) => getPageSize(doc, i)));
    expect(sizes.map((s) => [Math.round(s.width), Math.round(s.height), s.rotate])).toEqual([
      [595, 842, 0],
      [792, 612, 0],
      [420, 595, 0],
      [842, 595, 90],
    ]);
    await doc.destroy();
  });
});

describe('getText', () => {
  it('returns strings with top-left boxes in points', async () => {
    const doc = await openPdf(fixture('sample-3-pages.pdf'));
    const page = await getText(doc, 0);
    const title = page.items.find((i) => i.str === 'Sample page 1 of 3')!;
    expect(title.x).toBeCloseTo(48, 0);
    // drawn with its baseline 58pt below the top at 24pt: the box sits around it
    expect(title.y).toBeLessThan(58);
    expect(title.y + title.height).toBeGreaterThan(58);
    expect(page.width).toBe(612);
    expect(textToString(page.items)).toContain('quick brown fox');
    await doc.destroy();
  });

  it('extracts Greek, Cyrillic and accented Latin', async () => {
    const doc = await openPdf(fixture('sample-unicode.pdf'));
    const text = textToString((await getText(doc, 0)).items);
    expect(text).toContain('Γαζέες');
    expect(text).toContain('французских');
    expect(text).toContain('Zażółć gęślą jaźń');
    await doc.destroy();
  });
});

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { decodePDFRawStream, degrees, PDFArray, PDFDocument, PDFRawStream, PDFRef, StandardFonts } from 'pdf-lib';
import { loadPdfjs, openPdf } from '@/engines/pdf';
import { addWatermark, imageType, stampFont, textBox } from '@/tools/lib/pdf-stamp/stamp';

beforeAll(async () => {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  // the Unicode font is fetched from /fonts/pdf/ in the browser; serve it from public/ here
  vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(`public${new URL(url, 'http://x').pathname}`)));
  const lib = await loadPdfjs();
  lib.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs').href;
});

/** Letter; A4 /Rotate 90; cropped; cropped + /Rotate 270; /Rotate 180 */
async function awkwardPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const add = (size: [number, number], rotate = 0, crop?: [number, number, number, number]) => {
    const page = doc.addPage(size);
    page.drawText('body', { x: 100, y: 100, size: 12, font });
    if (rotate) page.setRotation(degrees(rotate));
    if (crop) page.setCropBox(...crop);
  };
  add([612, 792]);
  add([595, 842], 90);
  add([612, 792], 0, [50, 60, 350, 440]);
  add([612, 792], 270, [40, 30, 500, 600]);
  add([612, 792], 180);
  return PDFDocument.load(await doc.save());
}

/** Text items with their origin in top-left viewport points and run direction, per page */
async function readBack(bytes: Uint8Array) {
  const doc = await openPdf(bytes);
  const out = [];
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    const texts = items.flatMap((it) => {
      if (!('str' in it) || !it.str.trim()) return [];
      const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      const [x2, y2] = viewport.convertToViewportPoint(it.transform[4] + it.transform[0], it.transform[5] + it.transform[1]);
      return [{ str: it.str, x, y, dx: x2 - x, dy: y2 - y }];
    });
    out.push({ width: viewport.width, height: viewport.height, texts });
  }
  await doc.destroy();
  return out;
}

const streams = (doc: PDFDocument, pageIndex: number) =>
  (doc.getPage(pageIndex).node.Contents() as PDFArray).asArray().map((r) => new TextDecoder().decode(decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode()));

const text = { kind: 'text' as const, text: 'CONFIDENTIAL', family: 'sans' as const, bold: true, size: 48, color: '#cc0000' };
const base = { pages: [0, 1, 2, 3, 4], opacity: 0.3, angleMode: 'level' as const, angle: 0, placement: 'mc' as const, margin: 20, under: false };

describe('addWatermark', () => {
  it('centres the text on each page as seen, upright', async () => {
    const doc = await awkwardPdf();
    await addWatermark(doc, { mark: text, ...base });
    const font = await stampFont(doc, 'sans', true, 'CONFIDENTIAL');
    const box = textBox(font, 'CONFIDENTIAL', 48);
    for (const p of await readBack(await doc.save())) {
      const item = p.texts.find((t) => t.str === 'CONFIDENTIAL')!;
      expect(item.x + box.width / 2).toBeCloseTo(p.width / 2, 2);
      expect(item.dx).toBeGreaterThan(0);
      expect(Math.abs(item.dy)).toBeLessThan(1e-6);
    }
  });

  it('runs diagonal text up and to the right, tiles, and only on the chosen pages', async () => {
    const doc = await awkwardPdf();
    await addWatermark(doc, { mark: { ...text, size: 24 }, ...base, pages: [1], angleMode: 'diagonal', placement: 'tile', margin: 40 });
    const bytes = await doc.save();
    expect(streams(await PDFDocument.load(bytes), 1).at(-1)!.match(/ Do\b/g)!.length).toBeGreaterThan(6);
    // pdf.js trims tiles that run off the page, so match pieces of the word
    const pages = await readBack(bytes);
    const marks = pages[1].texts.filter((t) => 'CONFIDENTIAL'.includes(t.str));
    expect(marks.length).toBeGreaterThan(0);
    // up and to the right on screen: x grows, viewport y shrinks
    expect(marks[0].dx).toBeGreaterThan(0);
    expect(marks[0].dy).toBeLessThan(0);
    expect(pages[0].texts.some((t) => 'CONFIDENTIAL'.includes(t.str))).toBe(false);
  });

  it('draws "under" before the page content, with one XObject and one opacity state for all pages', async () => {
    const doc = await awkwardPdf();
    await addWatermark(doc, { mark: text, ...base, under: true });
    const saved = await PDFDocument.load(await doc.save());
    const [first, ...rest] = streams(saved, 0);
    expect(first).toMatch(/\/RnG\S* gs/);
    expect(first).toMatch(/\/RnX\S* Do/);
    // the page's own text still draws after (on top)
    expect(rest.join('\n')).toContain('Tj');

    const refsOf = (kind: 'XObject' | 'ExtGState') => new Set(saved.getPages().flatMap((p) => p.node.normalizedEntries()[kind].values().filter((v) => v instanceof PDFRef).map(String)));
    expect(refsOf('XObject').size).toBe(1);
    expect(refsOf('ExtGState').size).toBe(1);
  });

  it('places PNG images and recognises formats by their bytes', async () => {
    // 1×1 red PNG
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    expect(imageType(png)).toBe('png');
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(imageType(new TextEncoder().encode('GIF89a'))).toBeNull();
    const doc = await awkwardPdf();
    await addWatermark(doc, { mark: { kind: 'image', bytes: png, type: 'png', scale: 50 }, ...base, placement: 'tile' });
    const saved = await PDFDocument.load(await doc.save());
    expect(saved.getPageCount()).toBe(5);
    expect(streams(saved, 0).at(-1)).toMatch(/\/RnX\S* Do/);
  });

  it('skips pages the document does not have and refuses characters no font can draw', async () => {
    const doc = await awkwardPdf();
    expect(await addWatermark(doc, { mark: text, ...base, pages: [1, 9] })).toBe(1);
    await expect(addWatermark(doc, { mark: { ...text, text: 'Draft 草稿' }, ...base })).rejects.toMatchObject({ name: 'StampError', message: expect.stringContaining('草') });
  });

  it('turns an unreadable image into a friendly error', async () => {
    const doc = await awkwardPdf();
    await expect(addWatermark(doc, { mark: { kind: 'image', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), type: 'png', scale: 50 }, ...base })).rejects.toMatchObject({ name: 'StampError' });
  });
});

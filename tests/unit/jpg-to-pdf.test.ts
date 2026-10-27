import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { ImagesPdfWorker } from '@/tools/lib/jpg-to-pdf/pdf.worker';
import { combinedName, hasTransparency, layoutPage, MARGINS, type LayoutOptions } from '@/tools/lib/jpg-to-pdf/layout';

// the PDF worker exposes its api through Comlink; capture it instead
vi.mock('comlink', () => ({ expose: (api: unknown) => ((globalThis as { pdfWorker?: unknown }).pdfWorker = api), transfer: (x: unknown) => x }));

const base: LayoutOptions = { size: 'A4', orientation: 'auto', margin: 'none', placement: 'fit' };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe('layoutPage', () => {
  it('fits a portrait photo on a portrait A4 page, centred', () => {
    const l = layoutPage(3000, 4000, base);
    expect([l.width, l.height]).toEqual([595.28, 841.89]);
    close(l.image.w, 595.28);
    close(l.image.h, (595.28 * 4) / 3);
    close(l.image.y, (841.89 - l.image.h) / 2);
    close(l.image.x, 0);
  });

  it('turns the page for landscape images on auto', () => {
    const l = layoutPage(4000, 3000, base);
    expect([l.width, l.height]).toEqual([841.89, 595.28]);
    expect(layoutPage(4000, 3000, { ...base, orientation: 'portrait' }).width).toBe(595.28);
    expect(layoutPage(3000, 4000, { ...base, size: 'Letter', orientation: 'landscape' })).toMatchObject({ width: 792, height: 612 });
  });

  it('keeps margins clear', () => {
    const m = MARGINS.big;
    const l = layoutPage(1000, 1000, { ...base, margin: 'big' });
    expect(l.box).toEqual({ x: m, y: m, w: 595.28 - 2 * m, h: 841.89 - 2 * m });
    close(l.image.w, 595.28 - 2 * m);
    expect(l.image.x).toBeGreaterThanOrEqual(m);
  });

  it('fills the box and overflows it when filling', () => {
    const l = layoutPage(1000, 1000, { ...base, placement: 'fill', margin: 'small' });
    close(l.image.h, l.box.h);
    expect(l.image.w).toBeGreaterThan(l.box.w);
    close(l.image.x + l.image.w / 2, l.width / 2);
  });

  it('makes fit-to-image pages the shape of the image, plus margins', () => {
    const l = layoutPage(1920, 1080, { ...base, size: 'fit', margin: 'small' });
    close(l.width, 1920 * 0.75 + 36);
    close(l.height, 1080 * 0.75 + 36);
    expect(l.image).toEqual(l.box);
  });

  it('never makes a page larger than PDF allows', () => {
    const l = layoutPage(40_000, 1000, { ...base, size: 'fit' });
    expect(l.width).toBeLessThanOrEqual(14_400);
    close(l.image.w / l.image.h, 40);
  });
});

describe('hasTransparency', () => {
  it('spots any pixel that is not opaque', () => {
    expect(hasTransparency([1, 2, 3, 255, 4, 5, 6, 255])).toBe(false);
    expect(hasTransparency([1, 2, 3, 255, 4, 5, 6, 254])).toBe(true);
  });
});

describe('combinedName', () => {
  it('names the PDF after the first image', () => {
    expect(combinedName(['beach.HEIC'])).toBe('beach.pdf');
    expect(combinedName(['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg'])).toBe('IMG_0001-and-2-more.pdf');
    expect(combinedName([])).toBe('images.pdf');
  });
});

describe('PDF worker', () => {
  it('builds fitted, filled (clipped) and image-sized pages', async () => {
    await import('@/tools/lib/jpg-to-pdf/pdf.worker');
    const api = (globalThis as { pdfWorker?: unknown }).pdfWorker as ImagesPdfWorker;
    const png = new Uint8Array(readFileSync('public/icons/icon-512.png'));
    await api.start('holiday');
    await api.add(png, 'png', layoutPage(512, 512, { ...base, margin: 'small' }));
    await api.add(png, 'png', layoutPage(512, 512, { ...base, orientation: 'landscape', margin: 'big', placement: 'fill' }));
    await api.add(png, 'png', layoutPage(512, 512, { ...base, size: 'fit' }));
    await expect(api.add(new Uint8Array([1, 2, 3]), 'jpg', layoutPage(1, 1, base))).rejects.toThrow('embed');
    const doc = await PDFDocument.load(await api.save());
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getTitle()).toBe('holiday');
    expect(doc.getPage(1).getSize()).toEqual({ width: 841.89, height: 595.28 });
    expect(doc.getPage(2).getSize()).toEqual({ width: 384, height: 384 });
  });
});

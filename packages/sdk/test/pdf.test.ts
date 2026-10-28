import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { files, image, loadCanvas, pdf, RounderError } from '@roundertools/sdk';
import { FX, workDir } from './helpers';

const P = (f: string) => join(FX, 'pdf', f);
const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();
const photos = join(FX, 'compress-pdf/photos.pdf');
const dir = workDir();

describe('merge-pdf', () => {
  it('joins PDFs and images in order', async () => {
    const jpg = (await pdf.toImages(P('sample-images.pdf'), { dpi: 50, pages: '1' }).catch(() => null))?.[0];
    const inputs: (string | { name: string; data: Uint8Array })[] = [P('sample-3-pages.pdf'), P('sample-50-pages.pdf')];
    if (jpg) inputs.push({ name: 'page.jpg', data: jpg.data });
    const out = await pdf.merge(inputs, { bookmarks: true });
    expect(out.name).toBe('sample-3-pages-merged.pdf');
    expect(await pages(out.data)).toBe(53 + (jpg ? 1 : 0));
    expect(out.meta.inputs).toBe(inputs.length);
  });

  it('opens encrypted inputs with the password', async () => {
    const out = await pdf.merge([P('sample-encrypted.pdf'), P('sample-3-pages.pdf')], { password: 'rounder' });
    expect(await pages(out.data)).toBeGreaterThan(3);
  });
});

describe('split-pdf', () => {
  it('splits by ranges, every N pages, and by size', async () => {
    const byRange = await pdf.split(P('sample-50-pages.pdf'), { ranges: '1-10, 11-20, 21-' });
    expect(byRange.map((o) => o.name)).toEqual(['sample-50-pages-pages-1-10.pdf', 'sample-50-pages-pages-11-20.pdf', 'sample-50-pages-pages-21-50.pdf']);
    expect(await pages(byRange[2].data)).toBe(30);
    const every = await pdf.split(P('sample-3-pages.pdf'));
    expect(every).toHaveLength(3);
    const total = statSync(P('sample-50-pages.pdf')).size;
    const bySize = await pdf.split(P('sample-50-pages.pdf'), { maxSize: Math.ceil(total / 3) });
    expect(bySize.length).toBeGreaterThan(1);
    for (const part of bySize) expect(part.size).toBeLessThanOrEqual(Math.ceil(total / 3));
  });

  it('reports a bad range in words', async () => {
    await expect(pdf.split(P('sample-3-pages.pdf'), { ranges: '2-9' })).rejects.toMatchObject({ code: 'invalid-options', message: expect.stringMatching(/Page 9 doesn't exist/) });
  });
});

describe('compress-pdf', () => {
  it('matches the site on photos.pdf: 3,375,514 bytes to about 118,782 (within 2%)', async () => {
    const out = await pdf.compress(photos);
    expect(statSync(photos).size).toBe(3_375_514);
    expect(Math.abs(out.size - 118_782) / 118_782).toBeLessThan(0.02);
    expect(await pages(out.data)).toBe(await pages(new Uint8Array(readFileSync(photos))));
    expect(out.meta.images).toMatchObject({ replaced: 3 });
  });

  it('hits a size target with the sharpest setting that fits', async () => {
    const out = await pdf.compress(photos, { target: '100kb' });
    expect(out.size).toBeLessThanOrEqual(100_000);
    expect(out.meta).toMatchObject({ fits: true, target: 100_000 });
  });

  it('keeps the original when the lossless level cannot shrink it', async () => {
    const out = await pdf.compress(P('sample-3-pages.pdf'), { level: 'light' });
    expect(out.size).toBeLessThanOrEqual(statSync(P('sample-3-pages.pdf')).size);
  });

  it('says why a target is out of reach and writes the smallest result anyway', async () => {
    const out = await pdf.compress(P('sample-50-pages.pdf'), { target: '1kb' });
    expect(out.meta.fits).toBe(false);
    expect(out.warnings.join(' ')).toMatch(/parts/);
  });
});

describe('protect-pdf and unlock-pdf', () => {
  it('locks with AES-256 and unlocks again', async () => {
    const locked = await pdf.protect(P('sample-3-pages.pdf'), { password: 'correct horse', print: false });
    await expect(PDFDocument.load(locked.data)).rejects.toThrow(/encrypted/i);
    expect(locked.meta.restricted).toEqual(['print']);
    await expect(pdf.unlock({ name: 'l.pdf', data: locked.data })).rejects.toMatchObject({ code: 'needs-password' });
    await expect(pdf.unlock({ name: 'l.pdf', data: locked.data }, { password: 'wrong' })).rejects.toMatchObject({ code: 'wrong-password' });
    const open = await pdf.unlock({ name: 'l.pdf', data: locked.data }, { password: 'correct horse' });
    expect(await pages(open.data)).toBe(3);
  });

  it('unlocks the encrypted fixture', async () => {
    const out = await pdf.unlock(P('sample-encrypted.pdf'), { password: 'rounder' });
    expect(out.name).toBe('sample-encrypted-unlocked.pdf');
    expect(await pages(out.data)).toBeGreaterThan(0);
  });
});

describe('organize, numbers, watermark', () => {
  it('reorders, rotates and removes pages', async () => {
    const out = await pdf.organize(P('sample-3-pages.pdf'), { order: 'reverse', rotate: 90, rotatePages: '1', remove: '2' });
    const doc = await PDFDocument.load(out.data);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90]);
  });

  it('refuses to remove every page', async () => {
    await expect(pdf.organize(P('sample-3-pages.pdf'), { remove: '1-3' })).rejects.toBeInstanceOf(RounderError);
  });

  it('numbers pages in Cyrillic with the bundled Noto Sans', async () => {
    const out = await pdf.addPageNumbers(P('sample-3-pages.pdf'), { format: 'Страница {n} из {total}', skipFirst: true });
    expect(out.meta.numbered).toBe(2);
    // the whole font is embedded (fontkit's subsetter drops Cyrillic), about 0.5 MB
    expect(out.size).toBeGreaterThan(200_000);
  });

  it('watermarks every page', async () => {
    const out = await pdf.watermark(P('sample-3-pages.pdf'), { text: 'DRAFT', position: 'tile' });
    expect(out.meta.stamped).toBe(3);
    expect(await pages(out.data)).toBe(3);
  });
});

describe('jpg-to-pdf, text, images', () => {
  it('reads text in order', async () => {
    const text = await pdf.toText(P('sample-3-pages.pdf'), { markers: true });
    expect(text).toMatch(/----- Page 1 -----/);
    expect(text).toMatch(/quick brown fox/);
    expect(await pdf.toText(P('sample-3-pages.pdf'), { pages: '2', format: 'markdown' })).toMatch(/page 2 of 3/i);
  });

  it('extracts the embedded images', async () => {
    const outs = await pdf.extractImages(P('sample-images.pdf'), { minSize: 1 });
    expect(outs.length).toBeGreaterThan(0);
    expect(outs[0].name).toMatch(/^sample-images-image-\d+\.(png|jpg)$/);
  });

  it('builds a PDF from images, one per page', async () => {
    const png = await image.convert(join(FX, 'office/scan.png'), { to: 'png' });
    const jpg = await image.convert(join(FX, 'office/scan.png'), { to: 'jpeg' });
    const out = await pdf.fromImages([{ name: 'a.png', data: png.data }, { name: 'b.jpg', data: jpg.data }], { pageSize: 'Letter' });
    const doc = await PDFDocument.load(out.data);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it.runIf(!!loadCanvas())('renders pages to JPG and PNG', async () => {
    const jpgs = await pdf.toImages(P('sample-3-pages.pdf'), { dpi: 72 });
    expect(jpgs.map((o) => o.name)).toEqual(['sample-3-pages-page-1.jpg', 'sample-3-pages-page-2.jpg', 'sample-3-pages-page-3.jpg']);
    expect([...jpgs[0].data.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(jpgs[0].meta).toMatchObject({ width: 612, height: 792 });
    const [png] = await pdf.toImages(P('sample-3-pages.pdf'), { format: 'png', pages: '1', dpi: 36 });
    expect([...png.data.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  it('describes a PDF', async () => {
    const info = await files.info(P('sample-restricted.pdf'));
    expect(info).toMatchObject({ kind: 'pdf', pages: 3, encrypted: true });
    expect(info.restrictions).toContain('printing');
  });

  it('turns damaged files into a clear error', async () => {
    await expect(pdf.compress(P('not-a-pdf.pdf'))).rejects.toMatchObject({ code: 'damaged' });
  });

  it('saves without clobbering', async () => {
    const out = await pdf.split(P('sample-3-pages.pdf'), { ranges: '1' });
    const path = await out[0].save(join(dir, 'one.pdf'));
    await expect(out[0].save(path)).rejects.toMatchObject({ code: 'exists' });
    await expect(out[0].save(path, { overwrite: true })).resolves.toBe(path);
    expect(await out[0].save(`${dir}/sub/`)).toBe(join(dir, 'sub', out[0].name));
  });
});

describe('hostile PDFs', () => {
  // pdf.js 6 dropped its code compilers (and the isEvalSupported switch); fail loudly if an update brings one back
  it('ships a pdf.js that cannot compile code from a PDF', () => {
    const dist = join(import.meta.dirname, '../dist');
    const pdfjs = readdirSync(dist).filter((f) => /^pdf(\.worker)?-.*\.mjs$/.test(f));
    expect(pdfjs).toHaveLength(2);
    for (const f of pdfjs) expect(readFileSync(join(dist, f), 'utf8')).not.toMatch(/[^\w.]eval\(|new Function\(/);
  });
});

import { describe, expect, it } from 'vitest';
import { unzlibSync, zlibSync } from 'fflate';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFRef } from 'pdf-lib';
import { optimizeImages, type Codec } from '@/tools/lib/compress-pdf/images';
import { grayscale, isFlatGraphic, jpegInfo, targetSize, toRgba, unpredictPng, type Pixels } from '@/tools/lib/compress-pdf/pixels';
import { DEFAULT_SETTINGS, imageOptions } from '@/tools/lib/compress-pdf/settings';

/** a JPEG header with a frame of this size, padded with scan-like bytes */
function fakeJpeg(width: number, height: number, { components = 3, bytes = 50_000, sof = 0xc0 } = {}) {
  const head = [0xff, 0xd8, 0xff, sof, 0, 8 + 3 * components, 8, height >> 8, height & 255, width >> 8, width & 255, components];
  for (let c = 0; c < components; c++) head.push(c + 1, 0x11, 0);
  const out = new Uint8Array(Math.max(bytes, head.length + 4)).fill(0x22);
  out.set(head);
  out.set([0xff, 0xd9], out.length - 2);
  return out;
}

function noise(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  let x = 2463534242;
  for (let i = 0; i < data.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    data[i] = x & 255;
  }
  return { data, width, height };
}

const codec: Codec = {
  jpeg: async (_bytes, w, h) => noise(w, h),
  resize: async (_px, w, h) => noise(w, h),
  // pretend JPEG is 1/10 of a byte per pixel
  encode: async (px) => fakeJpeg(px.width, px.height, { bytes: Math.round((px.width * px.height) / 10) }),
};

describe('pixels', () => {
  it('reads JPEG frame headers', () => {
    expect(jpegInfo(fakeJpeg(4000, 3000))).toEqual({ width: 4000, height: 3000, components: 3, precision: 8, frame: 0 });
    expect(jpegInfo(fakeJpeg(10, 20, { components: 4, sof: 0xc2 }))).toMatchObject({ components: 4, frame: 2 });
    expect(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('skips APP segments before the frame header', () => {
    const app = [0xff, 0xe0, 0, 6, 1, 2, 3, 4];
    const jpg = fakeJpeg(64, 32);
    const withApp = new Uint8Array([...jpg.slice(0, 2), ...app, ...jpg.slice(2)]);
    expect(jpegInfo(withApp)).toMatchObject({ width: 64, height: 32 });
  });

  it('undoes PNG row filters', () => {
    // 2 rows × 3 bytes, bpp 1: Sub, then Up, Average and Paeth would all reproduce [10,20,30] / [11,22,33]
    const filtered = new Uint8Array([1, 10, 10, 10, 2, 1, 2, 3]);
    expect([...unpredictPng(filtered, 3, 1)!]).toEqual([10, 20, 30, 11, 22, 33]);
    const avg = new Uint8Array([0, 10, 20, 30, 3, 5, 0, 0]);
    // x0: 5 + (0+10)/2 = 10; x1: 0 + (10+20)/2 = 15; x2: 0 + (15+30)/2 = 22
    expect([...unpredictPng(avg, 3, 1)!]).toEqual([10, 20, 30, 10, 15, 22]);
    const paeth = new Uint8Array([0, 10, 20, 30, 4, 1, 1, 1]);
    expect([...unpredictPng(paeth, 3, 1)!]).toEqual([10, 20, 30, 11, 21, 31]);
    expect(unpredictPng(new Uint8Array([9, 1, 2, 3]), 3, 1)).toBeNull();
  });

  it('expands gray and RGB samples to RGBA, and grays them', () => {
    expect([...toRgba(new Uint8Array([7, 9]), 2, 1, 1).data]).toEqual([7, 7, 7, 255, 9, 9, 9, 255]);
    const px = toRgba(new Uint8Array([255, 0, 0]), 1, 1, 3);
    grayscale(px);
    expect([...px.data]).toEqual([76, 76, 76, 255]);
  });

  it('tells flat graphics from photos', () => {
    const flat = toRgba(new Uint8Array(300 * 3).map((_, i) => (i % 6 < 3 ? 0 : 200)), 300, 1, 3);
    expect(isFlatGraphic(flat, 3)).toBe(true);
    expect(isFlatGraphic(noise(300, 300), 3)).toBe(false);
  });

  it('works out a target size from the page size and dpi', () => {
    // A4's long side is 841.89pt = 11.69in → 1754px at 150 dpi
    expect(targetSize(4000, 3000, 841.89, 150)).toEqual({ width: 1754, height: 1316 });
    expect(targetSize(1800, 1200, 842, 150)).toBeNull(); // within 10%
    expect(targetSize(800, 600, 842, 150)).toBeNull();
  });

  it('maps levels to image options', () => {
    expect(imageOptions({ ...DEFAULT_SETTINGS, level: 'light' })).toBeNull();
    expect(imageOptions({ ...DEFAULT_SETTINGS, level: 'strong', dpi: 300 })).toEqual({ dpi: 100, quality: 60, grayscale: false });
    expect(imageOptions({ ...DEFAULT_SETTINGS, level: 'custom', dpi: 220, quality: 88, grayscale: true })).toEqual({ dpi: 220, quality: 88, grayscale: true });
  });
});

describe('optimizeImages', () => {
  async function sample() {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const ctx = doc.context;
    const photo = await doc.embedJpg(fakeJpeg(4000, 3000, { bytes: 900_000 }));
    page.drawImage(photo, { x: 0, y: 0, width: 595, height: 446 });

    const image = (extra: Record<string, unknown>, contents: Uint8Array) =>
      ctx.register(PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', BitsPerComponent: 8, ...extra }) as never, contents));
    const flatePhoto = (w: number, h: number) => {
      const px = noise(w, h);
      const rgb = new Uint8Array(w * h * 3).map((_, i) => px.data[Math.floor(i / 3) * 4 + (i % 3)]);
      return zlibSync(rgb);
    };
    const refs: Record<string, PDFRef> = {
      flate: image({ Width: 2000, Height: 1500, ColorSpace: 'DeviceRGB', Filter: 'FlateDecode' }, flatePhoto(2000, 1500)),
      flat: image({ Width: 1000, Height: 1000, ColorSpace: 'DeviceRGB', Filter: 'FlateDecode' }, zlibSync(new Uint8Array(3_000_000).map((_, i) => (i % 3000 < 1500 ? 255 : 0)))),
      cmyk: image({ Width: 4000, Height: 3000, ColorSpace: 'DeviceCMYK', Filter: 'DCTDecode' }, fakeJpeg(4000, 3000, { components: 4, bytes: 900_000 })),
      mask: image({ Width: 1500, Height: 1000, ColorSpace: 'DeviceGray', Filter: 'FlateDecode' }, flatePhoto(500, 1000)),
    };
    refs.masked = image({ Width: 3000, Height: 2000, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode', SMask: refs.mask }, fakeJpeg(3000, 2000, { bytes: 600_000 }));
    for (const [name, ref] of Object.entries(refs)) if (name !== 'mask') page.node.newXObject(name, ref);
    return { doc: await PDFDocument.load(await doc.save()), photoRef: photo.ref, refs };
  }

  const stream = (doc: PDFDocument, ref: PDFRef) => doc.context.lookup(ref) as PDFRawStream;
  const n = (doc: PDFDocument, ref: PDFRef, key: string) => (stream(doc, ref).dict.lookup(PDFName.of(key)) as PDFNumber | undefined)?.asNumber();

  it('downscales photos to the target dpi and skips what it should', async () => {
    const { doc, photoRef, refs } = await sample();
    const progress: [number, number][] = [];
    const stats = await optimizeImages(doc, { dpi: 150, quality: 75, grayscale: false }, codec, (done, total) => progress.push([done, total]));

    expect(stats.found).toBe(6);
    // the photo, the flate photo and the masked photo; not the flat graphic, the CMYK one or the mask
    expect(stats.replaced).toBe(3);
    expect(stats.after).toBeLessThan(stats.before);
    const [done, total] = progress.at(-1)!;
    expect(done).toBe(total);

    const photo = stream(doc, photoRef);
    expect(photo.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect([n(doc, photoRef, 'Width'), n(doc, photoRef, 'Height')]).toEqual([1754, 1316]);
    expect(jpegInfo(photo.contents)).toMatchObject({ width: 1754, height: 1316 });

    expect(stream(doc, refs.flate).dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(n(doc, refs.flate, 'Width')).toBe(1754);
    expect(n(doc, refs.flate, 'Height')).toBe(1316);
    expect(stream(doc, refs.flat).dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    expect(n(doc, refs.cmyk, 'Width')).toBe(4000);
    expect(n(doc, refs.mask, 'Width')).toBe(1500);
    // the masked image keeps its soft mask
    expect(stream(doc, refs.masked).dict.get(PDFName.of('SMask'))).toBe(refs.mask);

    // the result still parses
    const again = await PDFDocument.load(await doc.save());
    expect(again.getPageCount()).toBe(1);
  });

  it('grays flat graphics losslessly and reaches small color images', async () => {
    const { doc, refs } = await sample();
    const ctx = doc.context;
    const small = ctx.register(PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', BitsPerComponent: 8, Width: 40, Height: 30, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }) as never, fakeJpeg(40, 30, { bytes: 2_000 })));
    doc.getPage(0).node.newXObject('small', small);
    const stats = await optimizeImages(doc, { dpi: 150, quality: 75, grayscale: true }, codec);

    const flat = stream(doc, refs.flat);
    expect(flat.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    expect(flat.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
    expect(n(doc, refs.flat, 'Width')).toBe(1000);
    const gray = unzlibSync(flat.contents);
    expect(gray.length).toBe(1000 * 1000);
    expect([gray[0], gray[1499], gray[1500]]).toEqual([255, 255, 0]);
    expect(stream(doc, small).contents.length).not.toBe(2_000);
    expect(stats.replaced).toBe(5);
    await PDFDocument.load(await doc.save());
  });

  it('leaves images whose soft mask has /Matte at their size', async () => {
    const { doc, refs } = await sample();
    stream(doc, refs.mask).dict.set(PDFName.of('Matte'), doc.context.obj([0, 0, 0]));
    await optimizeImages(doc, { dpi: 150, quality: 75, grayscale: false }, codec);
    expect(n(doc, refs.masked, 'Width')).toBe(3000);
  });

  it('honors UserUnit and keeps full size on pages it cannot measure', async () => {
    const { doc, photoRef } = await sample();
    const page = doc.getPage(0).node;
    page.set(PDFName.of('UserUnit'), PDFNumber.of(2));
    await optimizeImages(doc, { dpi: 100, quality: 75, grayscale: false }, codec);
    // twice A4's long side at 100 dpi is 2339px
    expect(n(doc, photoRef, 'Width')).toBe(2339);

    const again = await sample();
    again.doc.getPage(0).node.delete(PDFName.of('MediaBox'));
    await optimizeImages(again.doc, { dpi: 150, quality: 75, grayscale: false }, codec);
    expect(n(again.doc, again.photoRef, 'Width')).toBe(4000);
  });

  it('skips same-size JPEG re-encodes at high quality', async () => {
    const { doc, photoRef, refs } = await sample();
    const stats = await optimizeImages(doc, { dpi: 600, quality: 95, grayscale: false }, codec);
    // no resize needed and quality 95 isn't worth a JPEG re-encode; the raw flate photo still gains
    expect(n(doc, photoRef, 'Width')).toBe(4000);
    expect(n(doc, refs.flate, 'Width')).toBe(2000);
    expect(stats.replaced).toBe(1);
  });
});

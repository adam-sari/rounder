import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unzlibSync, zlibSync } from 'fflate';
import { PDFDocument, PDFHexString, PDFName, type PDFPage, type PDFRef } from 'pdf-lib';
import { convert, dedupe, findImages } from '@/tools/lib/pdf-images/extract';
import { encodePng, PNG_GRAY, PNG_INDEXED, PNG_RGB } from '@/tools/lib/pdf-images/png';
import { unpack, unpredict } from '@/tools/lib/pdf-images/pixels';

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** a minimal PNG reader: header, palette and unfiltered rows */
function readPng(png: Uint8Array) {
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset);
  const chunks: Record<string, Uint8Array[]> = {};
  for (let at = 8; at < png.length; ) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    (chunks[type] ??= []).push(png.subarray(at + 8, at + 8 + len));
    at += len + 12;
  }
  const ihdr = new DataView(chunks.IHDR[0].buffer, chunks.IHDR[0].byteOffset);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  const depth = chunks.IHDR[0][8];
  const colorType = chunks.IHDR[0][9];
  const idat = new Uint8Array(chunks.IDAT.reduce((n, c) => n + c.length, 0));
  chunks.IDAT.reduce((at, c) => (idat.set(c, at), at + c.length), 0);
  const data = unpredict(unzlibSync(idat), { predictor: 15, colors: CHANNELS[colorType], bpc: depth, columns: width });
  return { width, height, depth, colorType, data, palette: chunks.PLTE?.[0], ended: !!chunks.IEND };
}

/** registers an image XObject stream on a page */
function addImage(pdf: PDFDocument, page: PDFPage, key: string, contents: Uint8Array, dict: Record<string, unknown>): PDFRef {
  const ref = pdf.context.register(pdf.context.stream(contents, { Type: 'XObject', Subtype: 'Image', ...dict } as never));
  page.node.setXObject(PDFName.of(key), ref);
  return ref;
}

const reload = async (pdf: PDFDocument) => PDFDocument.load(await pdf.save());

describe('PNG encoder', () => {
  it('round-trips RGB, 16-bit gray and 1-bit gray', () => {
    const rgb = Uint8Array.from({ length: 5 * 4 * 3 }, (_, i) => (i * 37) % 256);
    const a = readPng(encodePng({ width: 5, height: 4, colorType: PNG_RGB, depth: 8, data: rgb }));
    expect(a).toMatchObject({ width: 5, height: 4, depth: 8, colorType: 2, ended: true });
    expect([...a.data]).toEqual([...rgb]);

    const gray16 = Uint8Array.from({ length: 3 * 2 * 2 }, (_, i) => i * 20);
    expect([...readPng(encodePng({ width: 3, height: 2, colorType: PNG_GRAY, depth: 16, data: gray16 })).data]).toEqual([...gray16]);

    const bits = Uint8Array.from([0b10100000, 0b01000000]);
    const b = readPng(encodePng({ width: 3, height: 2, colorType: PNG_GRAY, depth: 1, data: bits }));
    expect([...b.data]).toEqual([...bits]);
  });
});

describe('pixel helpers', () => {
  it('unpacks sub-byte and 16-bit samples', () => {
    expect([...unpack(Uint8Array.from([0b10010000]), 4, 1, 1, 1)]).toEqual([255, 0, 0, 255]);
    expect([...unpack(Uint8Array.from([0b11100100]), 4, 1, 1, 2, false)]).toEqual([3, 2, 1, 0]);
    expect([...unpack(Uint8Array.from([0xab, 0xcd, 0x12, 0x34]), 2, 1, 1, 16)]).toEqual([0xab, 0x12]);
  });

  it('undoes TIFF and PNG predictors', () => {
    expect([...unpredict(Uint8Array.from([10, 5, 5, 1, 1, 1]), { predictor: 2, colors: 1, bpc: 8, columns: 3 })]).toEqual([10, 15, 20, 1, 2, 3]);
    // row 1 "Sub", row 2 "Up"
    const filtered = Uint8Array.from([1, 10, 5, 5, 2, 1, 1, 1]);
    expect([...unpredict(filtered, { predictor: 15, colors: 1, bpc: 8, columns: 3 })]).toEqual([10, 15, 20, 11, 16, 21]);
  });
});

describe('findImages + convert', () => {
  it('extracts the fixture’s images once each, with the pages they’re on', async () => {
    const doc = await PDFDocument.load(readFileSync('tests/fixtures/pdf/sample-images.pdf'));
    const refs = await dedupe(findImages(doc));
    expect(refs.map((r) => r.pages)).toEqual([[0], [1]]);
    const [gradient, checker] = refs.map(convert);
    expect(gradient).toMatchObject({ width: 320, height: 200, color: 'RGB', encoding: 'Flate' });
    expect(gradient.file?.ext).toBe('png');
    const png = readPng(gradient.file!.bytes);
    expect(png).toMatchObject({ width: 320, height: 200, colorType: 2 });
    // the fixture's gradient: [x * 0.8, y * 1.2, 255 - x * 0.6] at (x, y)
    const px = (x: number, y: number) => [...png.data.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3)];
    expect(px(100, 50)).toEqual([80, 60, 195]);
    expect(checker).toMatchObject({ width: 160, height: 160 });
  });

  it('keeps JPEG bytes untouched and notes a dropped soft mask', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
    const mask = pdf.context.register(pdf.context.stream(new Uint8Array(4).fill(255), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    addImage(pdf, page, 'Im1', jpeg, { Width: 2, Height: 2, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', SMask: mask });
    const [ref] = findImages(await reload(pdf));
    const img = convert(ref);
    expect(img).toMatchObject({ encoding: 'JPEG', color: 'RGB', note: "transparency isn't part of the JPEG" });
    expect(img.file?.ext).toBe('jpg');
    expect([...img.file!.bytes]).toEqual([...jpeg]);
  });

  it('rebuilds a 4-bit indexed image stored with a PNG predictor', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    // 4 × 2 pixels, 4 bits each: indices 0 1 2 3 / 3 2 1 0, rows filtered with "None"
    const rows = Uint8Array.from([0, 0x01, 0x23, 0, 0x32, 0x10]);
    addImage(pdf, page, 'Im1', zlibSync(rows), {
      Width: 4,
      Height: 2,
      BitsPerComponent: 4,
      ColorSpace: ['Indexed', 'DeviceRGB', 3, PDFHexString.of('ff000000ff000000ffffffff')],
      Filter: 'FlateDecode',
      DecodeParms: { Predictor: 15, Colors: 1, BitsPerComponent: 4, Columns: 4 },
    });
    const img = convert(findImages(await reload(pdf))[0]);
    const png = readPng(img.file!.bytes);
    expect(png).toMatchObject({ colorType: PNG_INDEXED, depth: 4 });
    expect([...png.data]).toEqual([0x01, 0x23, 0x32, 0x10]);
    expect([...png.palette!.subarray(0, 12)]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  });

  it('turns a soft mask into alpha and honours an inverting Decode', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const smask = pdf.context.register(pdf.context.flateStream(Uint8Array.from([0, 128, 255, 64]), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    const ref = pdf.context.register(pdf.context.flateStream(Uint8Array.from([10, 20, 30, 40]), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Decode: [1, 0], SMask: smask }));
    page.node.setXObject(PDFName.of('Im1'), ref);
    const png = readPng(convert(findImages(await reload(pdf))[0]).file!.bytes);
    expect(png.colorType).toBe(4);
    expect([...png.data]).toEqual([245, 0, 235, 128, 225, 255, 215, 64]);
  });

  it('finds images inside form XObjects and merges identical copies across pages', async () => {
    const pdf = await PDFDocument.create();
    const pixels = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const image = { Width: 2, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 };
    const p1 = pdf.addPage();
    pdf.addPage();
    const p3 = pdf.addPage();
    const inner = pdf.context.register(pdf.context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image', ...image }));
    const form = pdf.context.register(pdf.context.stream('q /Im0 Do Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], Resources: { XObject: { Im0: inner } } }));
    p1.node.setXObject(PDFName.of('Fm1'), form);
    // the same picture stored a second time, as merged files often do
    addImage(pdf, p3, 'Im9', pdf.context.flateStream(pixels).contents, { ...image, Filter: 'FlateDecode' });
    // stencil masks are shapes, not pictures
    addImage(pdf, p3, 'Mk1', new Uint8Array(1), { Width: 1, Height: 1, ImageMask: true, BitsPerComponent: 1 });
    const doc = await reload(pdf);
    expect(findImages(doc).map((r) => r.pages)).toEqual([[0], [2]]);
    const refs = await dedupe(findImages(doc));
    expect(refs.map((r) => r.pages)).toEqual([[0, 2]]);
  });

  it('keeps same-index images with different palettes apart, and survives a broken palette', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const indices = zlibSync(Uint8Array.from([0, 1]));
    const image = { Width: 2, Height: 1, BitsPerComponent: 8, Filter: 'FlateDecode' };
    addImage(pdf, page, 'Im1', indices, { ...image, ColorSpace: ['Indexed', 'DeviceRGB', 1, PDFHexString.of('ff00000000ff')] });
    addImage(pdf, page, 'Im2', indices, { ...image, ColorSpace: ['Indexed', 'DeviceRGB', 1, PDFHexString.of('00ff00ffffff')] });
    // a palette stream whose Flate data is garbage
    const bad = pdf.context.register(pdf.context.stream(Uint8Array.from([1, 2, 3]), { Filter: 'FlateDecode' }));
    addImage(pdf, page, 'Im3', indices, { ...image, ColorSpace: ['Indexed', 'DeviceRGB', 1, bad] });
    const refs = await dedupe(findImages(await reload(pdf)));
    expect(refs).toHaveLength(3);
    const [, , broken] = refs.map(convert);
    expect(broken).toMatchObject({ file: null, color: 'Indexed' });
  });

  it('leaves JPEG 2000 and CMYK images for pdf.js', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    addImage(pdf, page, 'Im1', new Uint8Array(8), { Width: 4, Height: 4, Filter: 'JPXDecode' });
    addImage(pdf, page, 'Im2', zlibSync(new Uint8Array(16)), { Width: 2, Height: 2, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8, Filter: 'FlateDecode' });
    const [jpx, cmyk] = findImages(await reload(pdf)).map(convert);
    expect(jpx).toMatchObject({ file: null, encoding: 'JPEG 2000' });
    expect(cmyk).toMatchObject({ file: null, color: 'CMYK', encoding: 'Flate' });
  });

  it('reads 16-bit RGB and 1-bit gray straight into PNG', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const rgb16 = Uint8Array.from({ length: 2 * 1 * 6 }, (_, i) => i * 10);
    addImage(pdf, page, 'Im1', zlibSync(rgb16), { Width: 2, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 16, Filter: 'FlateDecode' });
    addImage(pdf, page, 'Im2', zlibSync(Uint8Array.from([0b10100000])), { Width: 3, Height: 1, ColorSpace: ['ICCBased', pdf.context.register(pdf.context.stream('', { N: 1 }))], BitsPerComponent: 1, Filter: 'FlateDecode' });
    const [a, b] = findImages(await reload(pdf)).map(convert);
    expect(readPng(a.file!.bytes)).toMatchObject({ colorType: 2, depth: 16 });
    expect([...readPng(a.file!.bytes).data]).toEqual([...rgb16]);
    expect(b.color).toBe('Gray');
    expect(readPng(b.file!.bytes)).toMatchObject({ colorType: 0, depth: 1 });
  });
});

import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { files, image, loadCanvas, RounderError } from '@roundertools/sdk';
import { FX, withExif } from './helpers';

const scan = join(FX, 'office/scan.png');
let jpg: Uint8Array;
let size: { width: number; height: number };

const magic = (b: Uint8Array) => {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const s = String.fromCharCode(...b.subarray(0, 12));
  if (s.startsWith('RIFF') && s.endsWith('WEBP')) return 'webp';
  if (s.slice(4, 12).startsWith('ftypavi')) return 'avif';
  return 'unknown';
};

beforeAll(async () => {
  const out = await image.convert(scan, { to: 'jpeg', quality: 85 });
  jpg = out.data;
  size = { width: out.meta.width as number, height: out.meta.height as number };
});

describe('image-converter', () => {
  it.each(['jpeg', 'png', 'webp', 'avif'] as const)('writes real %s files', async (to) => {
    const out = await image.convert({ name: 'scan.jpg', data: jpg }, { to });
    expect(magic(out.data)).toBe(to);
    expect(out.name).toBe(`scan.${to === 'jpeg' ? 'jpg' : to}`);
    expect(out.meta).toMatchObject(size);
  });

  it.runIf(!!loadCanvas())('reads GIF through the optional canvas', async () => {
    const out = await image.convert(join(FX, 'media/sample.gif'), { to: 'png' });
    expect(out.meta).toMatchObject({ width: 160, height: 90 });
  });
});

describe('image-compressor and image-resizer', () => {
  it('compresses by quality and never hands back something bigger', async () => {
    const out = await image.compress({ name: 'scan.jpg', data: jpg }, { quality: 40 });
    expect(out.size).toBeLessThan(jpg.length);
    const keep = await image.compress({ name: 'scan.jpg', data: out.data }, { quality: 95 });
    expect(keep.meta.kept).toBe(true);
    expect(keep.size).toBe(out.size);
  });

  it('hits a size target', async () => {
    const target = Math.round(jpg.length / 3);
    const out = await image.compress({ name: 'scan.jpg', data: jpg }, { target });
    expect(out.size).toBeLessThanOrEqual(target);
    expect(out.meta.fits).toBe(true);
  });

  it('resizes by width, keeping the shape, and never enlarges unless asked', async () => {
    const out = await image.resize({ name: 'scan.jpg', data: jpg }, { width: 200 });
    expect(out.meta.width).toBe(200);
    expect(out.meta.height).toBe(Math.round((size.height * 200) / size.width));
    const same = await image.resize({ name: 'scan.jpg', data: jpg }, { width: size.width * 2 });
    expect(same.meta.width).toBe(size.width);
    expect(same.warnings.join(' ')).toMatch(/enlarge/);
    await expect(image.resize({ name: 'scan.jpg', data: jpg })).rejects.toMatchObject({ code: 'invalid-options' });
  });
});

describe('crop and rotate', () => {
  it('crops to an aspect ratio from the center, or to a box', async () => {
    const square = await image.crop({ name: 'scan.jpg', data: jpg }, { aspect: '1:1' });
    expect(square.meta.width).toBe(square.meta.height);
    const box = await image.crop({ name: 'scan.jpg', data: jpg }, { x: 10, y: 10, width: 50, height: 40 });
    expect(box.meta).toMatchObject({ width: 50, height: 40 });
  });

  it('turns a quarter, swapping width and height', async () => {
    const out = await image.rotate({ name: 'scan.jpg', data: jpg }, { by: 90 });
    expect(out.meta).toMatchObject({ width: size.height, height: size.width });
  });
});

describe('EXIF', () => {
  it('applies the orientation on decode, like a browser', async () => {
    const out = await image.convert({ name: 'turned.jpg', data: withExif(jpg, 6) }, { to: 'png' });
    expect(out.meta).toMatchObject({ width: size.height, height: size.width });
  });

  it('strips metadata without re-encoding, keeping the rotation tag', async () => {
    const tagged = withExif(jpg, 6);
    const out = await image.stripMetadata({ name: 'IMG.jpg', data: tagged });
    expect(out.name).toBe('IMG-clean.jpg');
    expect(out.meta.removed).toContain('EXIF');
    expect(Buffer.from(out.data).includes(Buffer.from('Rounder test camera'))).toBe(false);
    const info = await files.info({ name: 'IMG-clean.jpg', data: out.data });
    expect(info).toMatchObject({ kind: 'image', format: 'jpeg' });
  });
});

describe('hostile images', () => {
  it('refuses decompression bombs before decoding', async () => {
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 50_000);
    new DataView(png.buffer).setUint32(20, 50_000);
    const e = await image.convert({ name: 'bomb.png', data: png }, { to: 'jpeg' }).catch((x) => x);
    expect(e).toBeInstanceOf(RounderError);
    expect(e.code).toBe('unsupported-input');
    expect(e.message).toMatch(/megapixels/);
  });

  it('reads the size of AVIFs, and of JPEGs with fill bytes, before decoding', async () => {
    const ascii = (s: string) => [...new TextEncoder().encode(s)];
    const avif = new Uint8Array([0, 0, 0, 24, ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('mif1avif'), 0, 0, 0, 20, ...ascii('ispe'), 0, 0, 0, 0, 0, 0, 0xc3, 0x50, 0, 0, 0xc3, 0x50, ...new Array(32).fill(0)]);
    // 0xFF fill bytes before the SOF marker are legal, and must not hide its 65535 × 65535
    const jpeg = new Uint8Array(64);
    jpeg.set([0xff, 0xd8, 0xff, 0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0xff, 0xff, 0xff, 0xff, 0x03]);
    for (const [name, data] of [['bomb.avif', avif], ['bomb.jpg', jpeg]] as const) {
      const e = await image.convert({ name, data }, { to: 'png' }).catch((x) => x);
      expect(e?.message, name).toMatch(/megapixels/);
    }
  });

  it('says HEIC is not supported yet, with where to go instead', async () => {
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0, ...new TextEncoder().encode('mif1heic')]);
    await expect(image.convert({ name: 'a.heic', data: heic })).rejects.toMatchObject({ code: 'unsupported-input' });
  });
});

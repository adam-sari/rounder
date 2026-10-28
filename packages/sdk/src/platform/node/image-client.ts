import './imagedata';
import { encode, resize } from '@/engines/image/codec';
import { imageKind, type ImageKind } from '@/engines/image/kind';
import { cropPixels, orientPixels } from '@/engines/image/pixels';
import { formatInfo, resolveSize, type EncodeOptions, type Job, type ResizeOptions } from '@/engines/image/types';
import { readOrientation } from '@/tools/lib/exif/strip';
import { RounderError } from '../../core/errors';
import { loadCanvas } from './canvas';
import { decoders, initCodecs } from './codecs';

export * from '@/engines/image/types';
export * from '@/engines/image/kind';

/*
 * Node twin of src/engines/image/client.ts: the same exports, run in this process. Encoding, resizing, cropping and
 * turning are the site's own code (codec.ts, pixels.ts); only decoding differs: jSquash for JPG, PNG, WebP and AVIF,
 * the optional @napi-rs/canvas for GIF, BMP and SVG. Browsers apply a JPEG's EXIF orientation on decode, so this does too.
 */

/** decoding bombs: a 50,000 × 50,000 PNG is a few KB on disk and 10 GB in memory */
export const MAX_PIXELS = 100_000_000;

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/** width × height from the header, without decoding; null when the format isn't one we read here */
export function headerSize(b: Uint8Array, kind: ImageKind): { width: number; height: number } | null {
  if (kind === 'png' && b.length > 24) return { width: be32(b, 16), height: be32(b, 20) };
  if (kind === 'gif' && b.length > 10) return { width: le16(b, 6), height: le16(b, 8) };
  if (kind === 'bmp' && b.length > 26) return { width: Math.abs(new DataView(b.buffer, b.byteOffset).getInt32(18, true)), height: Math.abs(new DataView(b.buffer, b.byteOffset).getInt32(22, true)) };
  if (kind === 'webp' && b.length > 30) {
    const chunk = String.fromCharCode(...b.subarray(12, 16));
    if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === 'VP8L') return { width: 1 + (le16(b, 21) & 0x3fff), height: 1 + (((b[22] >> 6) | (b[23] << 2) | (b[24] << 10)) & 0x3fff) };
    if (chunk === 'VP8 ') return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
  }
  if (kind === 'avif') {
    // the largest 'ispe' (image spatial extent) box near the start: a grid's full size, not one tile's
    let best: { width: number; height: number } | null = null;
    const end = Math.min(b.length - 20, 1 << 20);
    for (let i = 4; i < end; i++) {
      if (b[i] !== 0x69 || b[i + 1] !== 0x73 || b[i + 2] !== 0x70 || b[i + 3] !== 0x65) continue;
      const size = { width: be32(b, i + 8), height: be32(b, i + 12) };
      if (!best || size.width * size.height > best.width * best.height) best = size;
    }
    return best;
  }
  if (kind === 'jpeg') {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      // any number of 0xFF fill bytes may come before a marker
      if (b[i + 1] === 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: be16(b, i + 7), height: be16(b, i + 5) };
      i += 2 + be16(b, i + 2);
    }
  }
  return null;
}

/** EXIF orientation (1–8) of a JPEG, 1 when it has none */
export function jpegOrientation(b: Uint8Array): number {
  for (let i = 2; i + 4 < b.length; ) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1];
    const len = be16(b, i + 2);
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === 'Exif') return readOrientation(b.subarray(i + 4, i + 2 + len)) || 1;
    if (marker === 0xda) return 1;
    i += 2 + len;
  }
  return 1;
}

/** orientation tag → the flip and clockwise turn that show the photo upright */
const ORIENT: Record<number, [0 | 90 | 180 | 270, boolean]> = { 1: [0, false], 2: [0, true], 3: [180, false], 4: [180, true], 5: [90, true], 6: [90, false], 7: [270, true], 8: [270, false] };

const asImageData = (img: { data: Uint8ClampedArray; width: number; height: number }) =>
  img instanceof ImageData ? img : new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height);

export async function decodeBytes(bytes: Uint8Array, kind?: ImageKind): Promise<ImageData> {
  kind ??= await imageKind(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const dims = headerSize(bytes, kind);
  if (dims && dims.width * dims.height > MAX_PIXELS) {
    throw new RounderError('unsupported-input', `This image is ${dims.width} × ${dims.height} pixels, more than the ${MAX_PIXELS / 1e6} megapixels the SDK decodes.`, { hint: 'Shrink it with another tool first.' });
  }
  if (kind === 'jpeg' || kind === 'png' || kind === 'webp' || kind === 'avif') {
    await initCodecs();
    const copy = bytes.slice().buffer;
    let img;
    try {
      img = await decoders[kind](copy as ArrayBuffer);
    } catch (e) {
      throw new RounderError('damaged', "This image couldn't be read. It may be damaged.", { cause: e });
    }
    if (!img) throw new RounderError('damaged', "This image couldn't be read. It may be damaged.");
    let out = asImageData(img);
    if (kind === 'jpeg') {
      const [turn, flip] = ORIENT[jpegOrientation(bytes)] ?? ORIENT[1];
      if (turn || flip) out = orientPixels(out, turn, flip, false);
    }
    return out;
  }
  if (kind === 'gif' || kind === 'bmp' || kind === 'svg' || kind === 'ico' || kind === 'tiff') {
    const canvas = loadCanvas();
    if (!canvas) throw new RounderError('missing-dependency', `Reading ${kind.toUpperCase()} images needs the optional @napi-rs/canvas package.`, { hint: 'npm install @napi-rs/canvas' });
    let img;
    try {
      img = await canvas.loadImage(bytes);
    } catch (e) {
      throw new RounderError('damaged', "This image couldn't be read. It may be damaged.", { cause: e });
    }
    const w = img.width || 2048;
    const h = img.height || 2048;
    if (w * h > MAX_PIXELS) throw new RounderError('unsupported-input', `This image is too big to decode (${w} × ${h} pixels).`);
    const c = canvas.createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return asImageData(ctx.getImageData(0, 0, w, h));
  }
  if (kind === 'heic') throw new RounderError('unsupported-input', "HEIC photos can't be read by the SDK yet.", { hint: 'Convert them on roundertools.com/heic-to-jpg, which runs in your browser.' });
  throw new RounderError('unsupported-input', "This file isn't an image format the SDK can read (JPG, PNG, WebP, AVIF; GIF, BMP and SVG with @napi-rs/canvas).");
}

const bytesOf = async (file: Blob) => new Uint8Array(await file.arrayBuffer());

/** Decode → crop → resize → rotate/flip → encode, like the site's image worker */
export async function processImage(file: Blob | ImageData, job: Job) {
  await initCodecs();
  let img = file instanceof ImageData ? file : await decodeBytes(await bytesOf(file));
  const sourceWidth = img.width;
  const sourceHeight = img.height;
  if (job.crop) img = cropPixels(img, job.crop);
  if (job.resize) {
    const size = resolveSize(img.width, img.height, job.resize);
    img = await resize(img, { ...size, method: job.resize.method });
    if (size.crop) img = cropPixels(img, size.crop);
  }
  img = orientPixels(img, job.rotate, job.flipX, job.flipY);
  const buffer = await encode(img, job.encode);
  return { blob: new Blob([buffer], { type: formatInfo[job.encode.format].mime }), width: img.width, height: img.height, sourceWidth, sourceHeight };
}

export async function decodeImage(file: Blob): Promise<ImageData> {
  return decodeBytes(await bytesOf(file));
}

export async function encodeImage(img: ImageData, options: EncodeOptions): Promise<Blob> {
  await initCodecs();
  return new Blob([await encode(img, options)], { type: formatInfo[options.format].mime });
}

export async function resizeImage(img: ImageData, options: ResizeOptions): Promise<ImageData> {
  await initCodecs();
  return resize(img, options);
}

export async function toDecodable(file: Blob): Promise<Blob> {
  return file;
}

export async function encodeCanvas(): Promise<Blob> {
  throw new RounderError('failed', 'encodeCanvas is browser-only.');
}

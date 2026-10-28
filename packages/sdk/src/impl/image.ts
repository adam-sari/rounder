import { imageKind, outputFormatFor, type ImageKind } from '@/engines/image/kind';
import { formatInfo, type EncodeOptions, type OutputFormat, type ResizeSpec } from '@/engines/image/types';
import { stripMetadata, type StripKind } from '@/tools/lib/exif/strip';
import { maxBox } from '@/tools/lib/crop-image/geometry';
import { defaultQuality } from '@/tools/lib/image-converter/formats';
import { fitFileSize } from '@/tools/lib/image-resizer/fit-file-size';
import { RounderError } from '../core/errors';
import { withSuffix, type Source } from '../core/io';
import type { OptionsOut } from '../core/op';
import { FileOutput } from '../core/output';
import { result, type OpResult } from '../core/run';
import { formatSize, parseSize } from '../core/size';
import type * as ops from '../ops/image';
import { decodeBytes, headerSize, processImage } from '../platform/node/image-client';

type Job = Parameters<typeof processImage>[1];

async function kindOf(bytes: Uint8Array, name: string): Promise<ImageKind> {
  return imageKind(Object.assign(new Blob([bytes.subarray(0, 64) as Uint8Array<ArrayBuffer>]), { name }));
}

const rename = (name: string, suffix: string, format: OutputFormat) => withSuffix(name, suffix, formatInfo[format].ext);

const out = (name: string, format: OutputFormat, data: Uint8Array, meta: Record<string, unknown>, warnings: string[] = []) =>
  new FileOutput({ name, mime: formatInfo[format].mime, data, meta, warnings });

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** decodes once, then runs `job` on the pixels */
async function load(src: Source) {
  const bytes = await src.bytes();
  const kind = await kindOf(bytes, src.name);
  const pixels = await decodeBytes(bytes, kind);
  return { bytes, kind, pixels };
}

const formatFor = (want: string, kind: ImageKind): OutputFormat => (want === 'keep' ? outputFormatFor(kind) : (want as OutputFormat));

/** encodes at the best quality (and, when needed, the smallest scale) that fits `target` bytes */
async function toTarget(pixels: ImageData, target: number, format: OutputFormat, base: Omit<Job, 'encode'> = {}) {
  if (format === 'png') {
    // PNG has no quality dial: fewer colors first, then fewer pixels
    for (const colors of [256, 128, 64, 32]) {
      const r = await processImage(pixels, { ...base, encode: { format, colors } });
      if (r.blob.size <= target) return { ...r, quality: 100, scale: 1, fits: true };
    }
  }
  const fit = await fitFileSize(
    target,
    async (quality, scale) => {
      const resize: ResizeSpec | undefined = scale < 1 ? { mode: 'scale', percent: scale * 100 } : base.resize;
      // quality only moves lossy formats; a PNG shrinks by scale alone, at 64 colors
      const r = await processImage(pixels, { ...base, resize, encode: format === 'png' ? { format, colors: 64 } : { format, quality } });
      return Object.assign(r.blob, { width: r.width, height: r.height });
    },
    { maxQuality: 92, minQuality: 40 },
  );
  return { blob: fit.out, width: fit.out.width, height: fit.out.height, quality: fit.quality, scale: fit.scale, fits: fit.fits };
}

export async function convert(inputs: Source[], o: OptionsOut<typeof ops.imageConverter>): Promise<OpResult> {
  const [src] = inputs;
  const { pixels } = await load(src);
  const encode: EncodeOptions = { format: o.to, quality: o.quality ?? defaultQuality[o.to], lossless: o.lossless, background: o.background };
  const r = await processImage(pixels, { encode });
  return result({ files: [out(rename(src.name, '', o.to), o.to, await bytesOf(r.blob), { width: r.width, height: r.height, format: o.to })] });
}

export async function compress(inputs: Source[], o: OptionsOut<typeof ops.imageCompressor>): Promise<OpResult> {
  const [src] = inputs;
  const { bytes, kind, pixels } = await load(src);
  const format = formatFor(o.format, kind);
  const resize: ResizeSpec | undefined = o.maxSide ? { mode: 'fit', width: o.maxSide, height: o.maxSide } : undefined;
  const warnings: string[] = [];
  const name = rename(src.name, '-compressed', format);
  if (o.target !== undefined) {
    const target = parseSize(o.target);
    const r = await toTarget(pixels, target, format, { resize });
    if (!r.fits) warnings.push(`The smallest version is ${formatSize(r.blob.size)}, still over ${formatSize(target)}.`);
    return result({ files: [out(name, format, await bytesOf(r.blob), { width: r.width, height: r.height, quality: r.quality, fits: r.fits, target }, warnings)], warnings });
  }
  const r = await processImage(pixels, { resize, encode: { format, quality: o.quality, colors: format === 'png' ? 256 : undefined } });
  let data: Uint8Array = await bytesOf(r.blob);
  let kept = false;
  if (o.neverBigger && data.length >= bytes.length && format === outputFormatFor(kind) && !resize) {
    data = bytes;
    kept = true;
    warnings.push('Compressing made it bigger, so the result is the original file.');
  }
  return result({ files: [out(name, format, data, { width: kept ? pixels.width : r.width, height: kept ? pixels.height : r.height, quality: o.quality, kept }, warnings)], warnings });
}

export async function resizeOp(inputs: Source[], o: OptionsOut<typeof ops.imageResizer>): Promise<OpResult> {
  const [src] = inputs;
  const { kind, pixels } = await load(src);
  const format = formatFor(o.format, kind);
  const name = rename(src.name, '-resized', format);
  const sized = o.width !== undefined || o.height !== undefined || o.percent !== undefined;
  if (!sized && o.target === undefined) throw new RounderError('invalid-options', 'Give a width, a height, a percent or a target size.');
  if (o.mode === 'scale' && o.percent === undefined) throw new RounderError('invalid-options', 'Scale mode needs a percent.');
  const resize: ResizeSpec | undefined = sized ? { mode: o.percent !== undefined ? 'scale' : o.mode, width: o.width, height: o.height, percent: o.percent, enlarge: o.enlarge } : undefined;
  const warnings: string[] = [];
  if (o.target !== undefined) {
    const target = parseSize(o.target);
    const r = await toTarget(pixels, target, format, { resize });
    if (!r.fits) warnings.push(`The smallest version is ${formatSize(r.blob.size)}, still over ${formatSize(target)}.`);
    return result({ files: [out(name, format, await bytesOf(r.blob), { width: r.width, height: r.height, quality: r.quality, fits: r.fits, target }, warnings)], warnings });
  }
  const r = await processImage(pixels, { resize, encode: { format, quality: o.quality } });
  if (!o.enlarge && r.width === pixels.width && r.height === pixels.height && resize?.mode === 'fit') warnings.push('The image is already smaller than that, so its size is unchanged (pass enlarge to scale it up).');
  return result({ files: [out(name, format, await bytesOf(r.blob), { width: r.width, height: r.height, sourceWidth: pixels.width, sourceHeight: pixels.height }, warnings)], warnings });
}

export async function crop(inputs: Source[], o: OptionsOut<typeof ops.cropImage>): Promise<OpResult> {
  const [src] = inputs;
  const { kind, pixels } = await load(src);
  const { width: W, height: H } = pixels;
  let box: { x: number; y: number; width: number; height: number };
  if (o.aspect) {
    const [a, b] = o.aspect.split(':').map(Number);
    if (!(a > 0 && b > 0)) throw new RounderError('invalid-options', `"${o.aspect}" isn't an aspect ratio. Use something like 16:9.`);
    const m = maxBox(a / b, W, H);
    box = { x: Math.round((W - m.width) / 2), y: Math.round((H - m.height) / 2), width: Math.round(m.width), height: Math.round(m.height) };
  } else if (o.width !== undefined && o.height !== undefined) {
    box = { x: o.x ?? 0, y: o.y ?? 0, width: o.width, height: o.height };
    if (box.x >= W || box.y >= H) throw new RounderError('invalid-options', `The box starts outside the ${W} × ${H} image.`);
  } else throw new RounderError('invalid-options', 'Give an aspect ratio (like 1:1), or a width and height (with x and y for the corner).');
  const format = formatFor(o.format, kind);
  const r = await processImage(pixels, { crop: box, encode: { format, quality: o.quality } });
  return result({ files: [out(rename(src.name, '-cropped', format), format, await bytesOf(r.blob), { width: r.width, height: r.height, box })] });
}

export async function rotate(inputs: Source[], o: OptionsOut<typeof ops.rotateImage>): Promise<OpResult> {
  const [src] = inputs;
  const { kind, pixels } = await load(src);
  const format = formatFor(o.format, kind);
  const r = await processImage(pixels, { rotate: o.by, flipX: o.flip === 'horizontal', flipY: o.flip === 'vertical', encode: { format, quality: o.quality } });
  return result({ files: [out(rename(src.name, '-rotated', format), format, await bytesOf(r.blob), { width: r.width, height: r.height, rotated: o.by, flip: o.flip })] });
}

export async function strip(inputs: Source[], o: OptionsOut<typeof ops.exifRemover>): Promise<OpResult> {
  const [src] = inputs;
  const bytes = await src.bytes();
  const kind = await kindOf(bytes, src.name);
  if (kind !== 'jpeg' && kind !== 'png' && kind !== 'webp') throw new RounderError('unsupported-input', 'Metadata removal works on JPG, PNG and WebP files.');
  const r = stripMetadata(bytes, kind as StripKind, { keepIcc: o.keepColorProfile, keepOrientation: o.keepOrientation });
  const removed = r.found.filter((f) => !f.kept).map((f) => f.label);
  const warnings = removed.length ? [] : ['There was no metadata to remove.'];
  return result({
    files: [new FileOutput({ name: withSuffix(src.name, '-clean'), mime: formatInfo[kind].mime, data: r.bytes, meta: { removed, kept: r.found.filter((f) => f.kept).map((f) => f.label), orientation: r.orientation }, warnings })],
    warnings,
  });
}

/** format, pixel size and metadata blocks, without decoding when the header says enough */
export async function info(src: Source) {
  const bytes = await src.bytes();
  const kind = await kindOf(bytes, src.name);
  let size = headerSize(bytes, kind);
  if (!size && kind !== 'unknown' && kind !== 'heic') {
    const px = await decodeBytes(bytes, kind).catch(() => null);
    if (px) size = { width: px.width, height: px.height };
  }
  const metadata = kind === 'jpeg' || kind === 'png' || kind === 'webp' ? stripMetadata(bytes, kind, {}).found.map((f) => ({ block: f.label, bytes: f.bytes })) : undefined;
  return { kind: 'image', format: kind, width: size?.width, height: size?.height, metadata };
}

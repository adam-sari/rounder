import { imageKind, outputFormatFor } from '@/engines/image/kind';
import { formatInfo, type OutputFormat } from '@/engines/image/types';
import { countChanged, highlightDiff, type Raster } from '@/tools/lib/compare-pdf/pixels';
import { RounderError } from '../core/errors';
import { withSuffix, type Source } from '../core/io';
import type { OptionsOut } from '../core/op';
import { FileOutput } from '../core/output';
import { result, type OpResult } from '../core/run';
import { formatSize, parseSize } from '../core/size';
import type * as ops from '../ops/image';
import { decodeBytes, encodeImage, resizeImage } from '../platform/node/image-client';

async function decode(src: Source) {
  const bytes = await src.bytes();
  const kind = await imageKind(Object.assign(new Blob([bytes.subarray(0, 64) as Uint8Array<ArrayBuffer>]), { name: src.name }));
  return { bytes, kind, pixels: await decodeBytes(bytes, kind) };
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** the largest size inside both limits, keeping the aspect ratio; never larger than the original */
export function fitWithin(w: number, h: number, maxEdge: number, maxPixels: number) {
  const scale = Math.min(1, maxEdge / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)), scale };
}

/**
 * Sized for a vision model: within the long-side and megapixel limits (so the model doesn't resize it again and the
 * upload stays small), re-encoded, and with its metadata gone, since decoding to pixels drops EXIF, GPS and the rest.
 */
export async function prepare(inputs: Source[], o: OptionsOut<typeof ops.imagePrep>): Promise<OpResult> {
  const [src] = inputs;
  const { bytes, kind, pixels } = await decode(src);
  const format: OutputFormat = o.format === 'keep' ? outputFormatFor(kind) : o.format;
  let size = fitWithin(pixels.width, pixels.height, o.maxEdge, o.maxMegapixels * 1e6);
  const limit = o.maxSize !== undefined ? parseSize(o.maxSize) : undefined;
  let quality = o.quality;
  let data: Uint8Array;
  // shrink quality, then size, until it fits the byte limit (if there is one)
  for (let tries = 0; ; tries++) {
    const img = size.width === pixels.width && size.height === pixels.height ? pixels : await resizeImage(pixels, { width: size.width, height: size.height, method: 'lanczos3' });
    data = await bytesOf(await encodeImage(img, { format, quality, background: '#ffffff', ...(format === 'png' && limit ? { colors: 256 } : {}) }));
    if (!limit || data.length <= limit || tries > 12) break;
    if (format !== 'png' && quality > 60) quality = Math.max(60, quality - 10);
    else size = { width: Math.max(1, Math.floor(size.width * 0.85)), height: Math.max(1, Math.floor(size.height * 0.85)), scale: size.scale * 0.85 };
  }
  const warnings: string[] = [];
  if (limit && data.length > limit) warnings.push(`It couldn't be brought under ${formatSize(limit)}; it's ${formatSize(data.length)}.`);
  if (format === 'jpeg' && formatInfo[outputFormatFor(kind)].alpha) warnings.push('Transparent areas were filled with white (JPG has no transparency). Use format png to keep them.');
  const name = withSuffix(src.name, '-prepped', formatInfo[format].ext);
  const meta = { width: size.width, height: size.height, originalWidth: pixels.width, originalHeight: pixels.height, bytesIn: bytes.length, quality: format === 'png' ? undefined : quality };
  return result({ files: [new FileOutput({ name, mime: formatInfo[format].mime, data, meta, warnings })] });
}

const raster = (img: ImageData): Raster => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });

/** bounding boxes of the changed areas, from a grid of changed cells, biggest first */
export function changedRegions(a: Raster, b: Raster, tolerance: number, cell = 16, max = 10) {
  const cols = Math.ceil(a.width / cell);
  const rows = Math.ceil(a.height / cell);
  const hot = new Uint8Array(cols * rows);
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]), Math.abs(a.data[i + 3] - b.data[i + 3]));
      if (d > tolerance) hot[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
    }
  }
  const seen = new Uint8Array(hot.length);
  const regions: { x: number; y: number; width: number; height: number; cells: number }[] = [];
  for (let start = 0; start < hot.length; start++) {
    if (!hot[start] || seen[start]) continue;
    let [x0, y0, x1, y1, cells] = [cols, rows, -1, -1, 0];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      cells++;
      [x0, y0, x1, y1] = [Math.min(x0, cx), Math.min(y0, cy), Math.max(x1, cx), Math.max(y1, cy)];
      // neighbours one cell away, diagonals too, so a thin slanted line stays one region
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          if (hot[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    const x = x0 * cell;
    const y = y0 * cell;
    regions.push({ x, y, width: Math.min(a.width, (x1 + 1) * cell) - x, height: Math.min(a.height, (y1 + 1) * cell) - y, cells });
  }
  regions.sort((p, q) => q.width * q.height - p.width * p.height);
  return { regions: regions.slice(0, max).map(({ cells: _, ...r }) => r), total: regions.length };
}

export async function diff(inputs: Source[], o: OptionsOut<typeof ops.imageDiff>): Promise<OpResult> {
  const [first, second] = await Promise.all(inputs.map(decode));
  let b = second.pixels;
  const warnings: string[] = [];
  const a = first.pixels;
  if (a.width !== b.width || a.height !== b.height) {
    if (!o.resize) throw new RounderError('invalid-options', `The images are different sizes (${a.width} × ${a.height} and ${b.width} × ${b.height}).`, { hint: 'Set resize to scale the second to the first.' });
    warnings.push(`The second image (${b.width} × ${b.height}) was scaled to ${a.width} × ${a.height} to compare.`);
    b = await resizeImage(b, { width: a.width, height: a.height, method: 'lanczos3' });
  }
  const ra = raster(a);
  const rb = raster(b);
  const changed = countChanged(ra, rb, o.tolerance);
  const total = a.width * a.height;
  const { regions, total: regionCount } = changedRegions(ra, rb, o.tolerance);
  const map = highlightDiff(ra, rb, { tolerance: o.tolerance });
  const png = await bytesOf(await encodeImage(new ImageData(map.data as Uint8ClampedArray<ArrayBuffer>, map.width, map.height), { format: 'png' }));
  const percent = Number(((changed / total) * 100).toFixed(changed && changed / total < 0.0001 ? 4 : 2));
  const meta = { identical: changed === 0, changedPercent: percent, changedPixels: changed, width: a.width, height: a.height, regions, ...(regionCount > regions.length ? { moreRegions: regionCount - regions.length } : {}) };
  const name = withSuffix(inputs[0].name, '-diff', 'png');
  return result({ files: [new FileOutput({ name, mime: 'image/png', data: png, meta, warnings })], data: meta });
}

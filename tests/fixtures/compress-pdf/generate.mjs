/*
 * A photo-heavy PDF for trying Compress PDF. Run from the project root:
 *   node tests/fixtures/compress-pdf/generate.mjs
 *
 * photos.pdf  3 A4 pages: a 2400×1600 color JPEG (quality 92) shown on pages 1
 *             and 2, a 1600×1200 grayscale JPEG, a 1200×900 Flate RGB photo,
 *             and a small flat-color chart that should stay lossless
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import pdfLib from 'pdf-lib';
import encode, { init } from '@jsquash/jpeg/encode.js';

const { PDFDocument, StandardFonts, rgb } = pdfLib;
const here = dirname(fileURLToPath(import.meta.url));
await init(await WebAssembly.compile(readFileSync(join(here, '../../../node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'))));

// smooth shapes plus a little grain, so it compresses like a photo rather than like noise
function photo(width, height, seed) {
  const data = new Uint8ClampedArray(width * height * 4);
  let x = seed;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      const grain = ((x & 255) - 128) / 24;
      const u = i / width;
      const v = j / height;
      const k = (j * width + i) * 4;
      data[k] = 120 + 90 * Math.sin(u * 7 + seed) * Math.cos(v * 5) + grain;
      data[k + 1] = 110 + 80 * Math.sin(v * 9 - u * 3) + grain;
      data[k + 2] = 140 + 70 * Math.cos((u + v) * 6 + seed) + grain;
      data[k + 3] = 255;
    }
  }
  return { data, width, height };
}

const jpeg = async (img, opts = {}) => new Uint8Array(await encode(img, { quality: 92, ...opts }));

const doc = await PDFDocument.create();
doc.setTitle('Compress PDF sample');
doc.setAuthor('Rounder test fixtures');
const font = await doc.embedFont(StandardFonts.Helvetica);
const color = await doc.embedJpg(await jpeg(photo(2400, 1600, 7)));
const gray = await doc.embedJpg(await jpeg(photo(1600, 1200, 3), { color_space: 1 })); // MozJpegColorSpace.GRAYSCALE

const raw = photo(1200, 900, 11);
const rgbBytes = new Uint8Array(1200 * 900 * 3).map((_, i) => raw.data[Math.floor(i / 3) * 4 + (i % 3)]);
const flate = doc.context.register(
  doc.context.flateStream(rgbBytes, { Type: 'XObject', Subtype: 'Image', Width: 1200, Height: 900, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }),
);
const chartPixels = new Uint8Array(800 * 500 * 3).map((_, i) => (Math.floor(i / 3) % 800 < 400 ? [255, 210, 94] : [30, 30, 30])[i % 3]);
const chart = doc.context.register(
  doc.context.stream(deflateSync(chartPixels), { Type: 'XObject', Subtype: 'Image', Width: 800, Height: 500, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode' }),
);

const A4 = [595.28, 841.89];
for (let n = 1; n <= 3; n++) {
  const page = doc.addPage(A4);
  page.drawText(`Compress PDF sample, page ${n} of 3`, { x: 48, y: 790, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
  page.drawText('Text like this stays sharp: only the photos are resampled.', { x: 48, y: 766, size: 11, font });
  if (n < 3) page.drawImage(color, { x: 48, y: 400, width: 499, height: 333 });
  if (n === 2) page.drawImage(gray, { x: 48, y: 40, width: 400, height: 300 });
  if (n === 3) {
    const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = pdfLib;
    const place = (name, ref, x, y, w, h) => {
      const key = page.node.newXObject(name, ref); // adds a random suffix
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(w, 0, 0, h, x, y), drawObject(key), popGraphicsState());
    };
    place('Flate', flate, 48, 380, 499, 374);
    place('Chart', chart, 48, 60, 400, 250);
  }
}

const bytes = await doc.save();
writeFileSync(join(here, 'photos.pdf'), bytes);
console.log(`photos.pdf ${bytes.length} bytes`);

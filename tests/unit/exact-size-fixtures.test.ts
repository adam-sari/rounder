// Target-size search on real encodes: mozjpeg (the wasm the site uses) runs in node, so the hit rate and the
// over-target behaviour are measured on actual bytes, not on a model. 10 photos and 10 PDFs are generated here.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import encodeJpeg, { init as initEncode } from '@jsquash/jpeg/encode.js';
import decodeJpeg, { init as initDecode } from '@jsquash/jpeg/decode.js';
import { optimizeImages, sampleImages, type Codec } from '@/tools/lib/compress-pdf/images';
import type { Pixels } from '@/tools/lib/compress-pdf/pixels';
import { estimateSizes, LADDER, missReason, searchLadder } from '@/tools/lib/compress-pdf/target';
import { fitFileSize } from '@/tools/lib/image-resizer/fit-file-size';
import { fitRange, padJpeg } from '@/tools/lib/image-resizer/form-size';
import { KB, verdict } from '@/tools/lib/exact-size/target';

// the decoder hands back an ImageData, which node doesn't have
(globalThis as Record<string, unknown>).ImageData ??= class {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
};

beforeAll(async () => {
  const wasm = (p: string) => WebAssembly.compile(readFileSync(`node_modules/@jsquash/jpeg/codec/${p}`));
  await initEncode(await wasm('enc/mozjpeg_enc.wasm'));
  await initDecode(await wasm('dec/mozjpeg_dec.wasm'));
});

/** smooth shapes plus grain, so it compresses like a photo; more grain is harder to compress */
function photo(width: number, height: number, seed: number, grain = 24): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  let x = seed * 2654435761 || 1;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      const g = ((x & 255) - 128) / (256 / grain);
      const u = i / width;
      const v = j / height;
      const k = (j * width + i) * 4;
      data[k] = 120 + 90 * Math.sin(u * 7 + seed) * Math.cos(v * 5) + g;
      data[k + 1] = 110 + 80 * Math.sin(v * 9 - u * 3 + seed) + g;
      data[k + 2] = 140 + 70 * Math.cos((u + v) * 6 + seed) + g;
      data[k + 3] = 255;
    }
  }
  return { data, width, height };
}

/** box-filter resample (area average down, nearest up): plain, but honest about bytes */
function resample(px: Pixels, w: number, h: number): Pixels {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = px.width / w;
  const sy = px.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0, i = (yy * px.width + x0) * 4; xx < x1; xx++, i += 4) {
          r += px.data[i];
          g += px.data[i + 1];
          bl += px.data[i + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = bl / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

const jpeg = async (px: Pixels, quality: number) => new Uint8Array(await encodeJpeg(px as ImageData, { quality }));
const scaled = (px: Pixels, scale: number) =>
  scale === 1 ? px : resample(px, Math.max(1, Math.round(px.width * scale)), Math.max(1, Math.round(px.height * scale)));

/** encode(quality, scale) for the size searches: the bytes and their count */
const encoder = (px: Pixels) => async (q: number, s: number) => {
  const bytes = await jpeg(scaled(px, s), q);
  return { bytes, size: bytes.length };
};

const codec: Codec = {
  jpeg: async (bytes, w, h) => {
    const img = (await decodeJpeg(bytes.slice().buffer)) as unknown as Pixels;
    return img.width === w && img.height === h ? img : resample(img, w, h);
  },
  resize: async (px, w, h) => resample(px, w, h),
  encode: (px, q) => jpeg(px, q),
};

describe('image to a size, on real JPEG encodes', () => {
  const photos = [
    [640, 480, 1, 16],
    [800, 600, 2, 40],
    [1024, 768, 3, 24],
    [1200, 900, 4, 64],
    [1280, 720, 5, 24],
    [1500, 1000, 6, 32],
    [900, 1200, 7, 48],
    [1600, 1200, 8, 20],
    [2000, 1500, 9, 28],
    [1800, 1200, 10, 80],
  ].map(([w, h, seed, grain]) => photo(Math.round(w * 0.6), Math.round(h * 0.6), seed, grain));

  it('lands every photo under 20, 50, 100 and 200 KB without wasting the budget', { timeout: 300_000 }, async () => {
    let cases = 0;
    let hits = 0;
    for (const px of photos) {
      for (const kb of [20, 50, 100, 200]) {
        const max = kb * KB;
        const r = await fitRange({ max }, encoder(px));
        cases++;
        if (r.out.size <= max) hits++;
        // a photo that needed squeezing ends up reasonably close to its budget, not far below it
        if (r.scale < 1 || r.quality < 92) expect(r.out.size, `${px.width}×${px.height} → ${kb} KB`).toBeGreaterThan(max * 0.6);
      }
    }
    expect(hits / cases).toBe(1);
  });

  it('keeps a 20–50 KB range, and pads a fixed-size signature up to its minimum', { timeout: 120_000 }, async () => {
    for (const px of photos.slice(0, 5)) {
      const r = await fitRange({ min: 20 * KB, max: 50 * KB }, async (q, s) => {
        const bytes = await jpeg(scaled(px, s), q);
        return { bytes, size: bytes.length };
      });
      const out = r.short ? padJpeg(r.out.bytes, r.short) : r.out.bytes;
      expect(verdict(out.length, { min: 20 * KB, max: 50 * KB }).ok).toBe(true);
    }
    // a 140 × 60 signature on white is far under 10 KB even at quality 100
    const sig = resample(photo(700, 300, 11, 4), 140, 60);
    const r = await fitRange({ min: 10 * KB, max: 20 * KB }, async (q) => {
      const bytes = await jpeg(sig, q);
      return { bytes, size: bytes.length };
    }, { fixedSize: true });
    expect(r.quality).toBe(100);
    expect(r.short).toBeGreaterThan(0);
    const padded = padJpeg(r.out.bytes, r.short + 512);
    expect(verdict(padded.length, { min: 10 * KB, max: 20 * KB }).ok).toBe(true);
    // the padded file still decodes to the same picture
    const back = (await decodeJpeg(padded.slice().buffer)) as unknown as Pixels;
    expect([back.width, back.height]).toEqual([140, 60]);
  });

  it('reports a miss when even the smallest picture is over', async () => {
    const px = photos[9];
    const r = await fitRange({ max: 300 }, async (q, s) => {
      const bytes = await jpeg(scaled(px, s), q);
      return { bytes, size: bytes.length };
    });
    expect(r.fits).toBe(false);
    expect(verdict(r.out.size, { max: 300 }).miss).toBe('over');
  });
});

describe('PDF to a size, on real JPEG encodes', () => {
  /** pages of text with photos; `lines` of small print per page add bytes no image setting can remove */
  async function makePdf(i: number, pages: number, photosPerPage: number, side: number, lines: number) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let p = 0; p < pages; p++) {
      const page = doc.addPage([595.28, 841.89]);
      for (let l = 0; l < lines; l++) page.drawText(`Line ${l} of page ${p + 1}: application details, reference ${i * 1000 + l}, ${'x'.repeat(40 + (l % 30))}`, { x: 30, y: 820 - (l % 90) * 9, size: 6, font });
      for (let k = 0; k < photosPerPage; k++) {
        const img = await doc.embedJpg(await jpeg(photo(side, Math.round(side * 0.75), i * 10 + p * 3 + k, 28), 90));
        page.drawImage(img, { x: 40, y: 40 + k * 260, width: 515, height: 386 / Math.max(1, photosPerPage / 1.5) });
      }
    }
    return doc.save();
  }

  const specs: [pages: number, photos: number, side: number, lines: number][] = [
    [1, 1, 1600, 10],
    [1, 2, 1400, 40],
    [2, 1, 1800, 20],
    [3, 1, 1200, 60],
    [2, 2, 1000, 30],
    [4, 1, 1400, 10],
    [1, 3, 1200, 80],
    [5, 1, 900, 40],
    [3, 2, 800, 20],
    // mostly text: no image setting gets this under 100 KB
    [6, 0, 0, 400],
  ];

  it('hits 100, 200, 500 KB and 1 MB when reachable, and says why when not', { timeout: 600_000 }, async () => {
    let reachable = 0;
    let hits = 0;
    for (const [n, spec] of specs.entries()) {
      const bytes = await makePdf(n + 1, ...spec);
      const lossless = (await (await PDFDocument.load(bytes)).save({ useObjectStreams: true })).length;
      const sample = await sampleImages(await PDFDocument.load(bytes), LADDER.map((r) => ({ ...r, grayscale: false })), codec);
      const estimates = estimateSizes(sample, lossless);
      // a full pass per rung, once: the targets below share them
      const passes = new Map<number, number>();
      const pass = async (i: number) => {
        if (!passes.has(i)) {
          const doc = await PDFDocument.load(bytes);
          await optimizeImages(doc, { ...LADDER[i], grayscale: false }, codec);
          passes.set(i, (await doc.save({ useObjectStreams: true })).length);
        }
        return { size: passes.get(i)!, out: i };
      };
      for (const kb of [100, 200, 500, 1000]) {
        const target = kb * KB;
        if (lossless <= target) continue; // already fits: the tool hands back the lossless pass
        const r = await searchLadder(target, estimates, pass);
        expect(r.tries.length).toBeLessThanOrEqual(3);
        const smallest = (await pass(LADDER.length - 1)).size;
        if (smallest <= target) {
          reachable++;
          if (r.fits) hits++;
        } else {
          // over target: no false hope, the smallest attempt comes back, and the reason fits the file
          expect(r.fits).toBe(false);
          const why = missReason({ target, size: r.best.size, lossless, candidateBytes: sample.candidateBytes, candidates: sample.candidates, grayscale: false });
          expect(why.parts).toBeGreaterThanOrEqual(2);
          if (!sample.candidates) expect(why.why).toMatch(/no photos/);
        }
        if (r.fits) expect(r.best.size).toBeLessThanOrEqual(target);
      }
    }
    expect(reachable).toBeGreaterThanOrEqual(15);
    expect(hits / reachable).toBeGreaterThanOrEqual(0.9);
  });

  it('counts photos the browser can’t redraw, and blames the browser, not the file', async () => {
    const bytes = await makePdf(1, 2, 1, 1200, 10);
    // like a browser without OffscreenCanvas in workers
    const broken: Codec = { ...codec, jpeg: () => Promise.reject(new ReferenceError("Can't find variable: OffscreenCanvas")) };
    const sample = await sampleImages(await PDFDocument.load(bytes), LADDER.map((r) => ({ ...r, grayscale: false })), broken);
    expect(sample.candidates).toBe(2);
    expect(sample.unreadable).toBe(sample.samples.length);
    expect((await sampleImages(await PDFDocument.load(bytes), [{ ...LADDER[0], grayscale: false }], codec)).unreadable).toBe(0);
    const why = missReason({ target: 100 * KB, size: bytes.length, lossless: bytes.length, candidateBytes: bytes.length, candidates: 2, grayscale: false, unreadable: true });
    expect(why.why).toMatch(/This browser couldn't recompress the photos/);
  });
});

describe('images to a PDF under a size', () => {
  it('fits four photos into 200 KB by quality first, then pixel size', { timeout: 120_000 }, async () => {
    const pics = [1, 2, 3, 4].map((s) => photo(2000, 1500, 40 + s, 28));
    const build = async (q: number, scale: number) => {
      const doc = await PDFDocument.create();
      for (const px of pics) {
        const side = Math.max(300, Math.round(2500 * scale));
        const k = Math.min(1, side / Math.max(px.width, px.height));
        const img = await doc.embedJpg(await jpeg(scaled(px, k), q));
        doc.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0 });
      }
      return { size: (await doc.save()).length };
    };
    const r = await fitFileSize(200 * KB, build, { maxQuality: 85, minQuality: 45, maxSteps: 6, minScale: 0.12 });
    expect(r.fits).toBe(true);
    expect(r.out.size).toBeGreaterThan(200 * KB * 0.5);
  });
});

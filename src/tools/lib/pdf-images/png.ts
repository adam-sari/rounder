import { zlibSync } from 'fflate';

/** PNG color types */
export const PNG_GRAY = 0;
export const PNG_RGB = 2;
export const PNG_INDEXED = 3;
export const PNG_GRAY_ALPHA = 4;
export const PNG_RGBA = 6;

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export interface PngImage {
  width: number;
  height: number;
  colorType: number;
  /** 1, 2, 4, 8 or 16 */
  depth: number;
  /** packed rows, each ceil(width × channels × depth / 8) bytes, no filter bytes */
  data: Uint8Array;
  /** RGB triplets, for indexed images */
  palette?: Uint8Array;
}

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array, start: number, end: number) {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array) {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Prefixes each row with a filter byte. Full-byte images get the filter with the
 * smallest sum of absolute differences per row (the usual heuristic, as in libpng);
 * palette and sub-byte images compress best unfiltered.
 */
function filterRows(img: PngImage, rowBytes: number): Uint8Array {
  const { data, height } = img;
  const out = new Uint8Array(height * (rowBytes + 1));
  const adaptive = img.depth >= 8 && img.colorType !== PNG_INDEXED;
  const bpp = Math.max(1, (CHANNELS[img.colorType] * img.depth) >> 3);
  const trial = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * rowBytes, (y + 1) * rowBytes);
    const dst = y * (rowBytes + 1);
    if (!adaptive) {
      out.set(row, dst + 1);
      continue;
    }
    const prev = y ? data.subarray((y - 1) * rowBytes, y * rowBytes) : undefined;
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= bpp ? prev[i - bpp] : 0;
        const predicted = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i] - predicted) & 0xff;
        trial[i] = v;
        score += v < 128 ? v : 256 - v;
        if (score >= bestScore) break;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
        out[dst] = f;
        out.set(trial, dst + 1);
      }
    }
    out[dst] = best;
  }
  return out;
}

/** Encodes raw pixels as a PNG file */
export function encodePng(img: PngImage): Uint8Array {
  const rowBytes = Math.ceil((img.width * CHANNELS[img.colorType] * img.depth) / 8);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, img.width);
  view.setUint32(4, img.height);
  ihdr[8] = img.depth;
  ihdr[9] = img.colorType;
  const chunks = [chunk('IHDR', ihdr)];
  if (img.palette) chunks.push(chunk('PLTE', img.palette));
  chunks.push(chunk('IDAT', zlibSync(filterRows(img, rowBytes), { level: 6 })), chunk('IEND', new Uint8Array(0)));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const out = new Uint8Array(8 + chunks.reduce((n, c) => n + c.length, 0));
  out.set(signature);
  let at = 8;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

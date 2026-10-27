/*
 * A small GIF decoder for browsers without ImageDecoder (and for tests). Yields fully
 * composited RGBA frames one at a time, honouring transparency and disposal methods,
 * so a long GIF never has to be held in memory as a whole.
 */

export interface GifHeader {
  width: number;
  height: number;
  /** 0 = loop forever, null = play once */
  loop: number | null;
}

export interface GifFrame {
  index: number;
  rgba: Uint8ClampedArray;
  /** browsers treat delays under 20 ms as 100 ms; so do we */
  delayMs: number;
}

interface Descriptor {
  x: number;
  y: number;
  w: number;
  h: number;
  interlaced: boolean;
  palette: Uint8Array;
  transparent: number;
  disposal: number;
  delayMs: number;
  dataStart: number;
}

export function isGif(bytes: Uint8Array) {
  return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46; // GIF
}

function lzw(bytes: Uint8Array, start: number, minCodeSize: number, pixelCount: number): Uint8Array {
  // concatenate sub-blocks first
  const chunks: Uint8Array[] = [];
  let p = start;
  let total = 0;
  while (p < bytes.length && bytes[p] !== 0) {
    const len = bytes[p];
    chunks.push(bytes.subarray(p + 1, p + 1 + len));
    total += len;
    p += len + 1;
  }
  const data = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    data.set(c, off);
    off += c.length;
  }

  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let codeSize = minCodeSize + 1;
  let next = clear + 2;
  let old = -1;
  let first = 0;
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;

  for (let i = 0; i < data.length && o < pixelCount; ) {
    while (bits < codeSize && i < data.length) {
      acc |= data[i++] << bits;
      bits += 8;
    }
    if (bits < codeSize) break;
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    bits -= codeSize;

    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = clear + 2;
      old = -1;
      continue;
    }
    if (code === eoi) break;
    if (old === -1) {
      out[o++] = suffix[code];
      old = first = code;
      continue;
    }
    let sp = 0;
    let c = code;
    if (code >= next) {
      stack[sp++] = first;
      c = old;
    }
    while (c >= clear) {
      stack[sp++] = suffix[c];
      c = prefix[c];
    }
    first = suffix[c];
    stack[sp++] = first;
    while (sp > 0 && o < pixelCount) out[o++] = stack[--sp];
    if (next < 4096) {
      prefix[next] = old;
      suffix[next] = first;
      next++;
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    old = code;
  }
  return out;
}

function skipBlocks(bytes: Uint8Array, p: number): number {
  while (p < bytes.length && bytes[p] !== 0) p += bytes[p] + 1;
  return p + 1;
}

/** Parses the header and frame table without decoding any pixels */
export function parseGif(bytes: Uint8Array): GifHeader & { frames: Descriptor[] } {
  if (!isGif(bytes)) throw new Error('Not a GIF file');
  const u16 = (p: number) => bytes[p] | (bytes[p + 1] << 8);
  const width = u16(6);
  const height = u16(8);
  const flags = bytes[10];
  let p = 13;
  let globalPalette: Uint8Array = new Uint8Array(0);
  if (flags & 0x80) {
    const size = 3 * (1 << ((flags & 7) + 1));
    globalPalette = bytes.subarray(p, p + size);
    p += size;
  }
  let loop: number | null = null;
  let gce = { transparent: -1, disposal: 0, delayMs: 100 };
  const frames: Descriptor[] = [];
  while (p < bytes.length) {
    const block = bytes[p];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      const label = bytes[p + 1];
      if (label === 0xf9) {
        const packed = bytes[p + 3];
        const delay = u16(p + 4) * 10;
        gce = { disposal: (packed >> 2) & 7, transparent: packed & 1 ? bytes[p + 6] : -1, delayMs: delay < 20 ? 100 : delay };
      } else if (label === 0xff && String.fromCharCode(...bytes.subarray(p + 3, p + 14)) === 'NETSCAPE2.0') {
        loop = u16(p + 16);
      }
      p = skipBlocks(bytes, p + 2);
    } else if (block === 0x2c) {
      const f = bytes[p + 9];
      let palette: Uint8Array = globalPalette;
      let q = p + 10;
      if (f & 0x80) {
        const size = 3 * (1 << ((f & 7) + 1));
        palette = bytes.subarray(q, q + size);
        q += size;
      }
      frames.push({ x: u16(p + 1), y: u16(p + 3), w: u16(p + 5), h: u16(p + 7), interlaced: !!(f & 0x40), palette, ...gce, dataStart: q });
      p = skipBlocks(bytes, q + 1);
      gce = { transparent: -1, disposal: 0, delayMs: 100 };
    } else {
      break; // corrupt: keep what we have
    }
  }
  return { width, height, loop, frames };
}

const INTERLACE = [
  [0, 8],
  [4, 8],
  [2, 4],
  [1, 2],
];

/** Decodes and composites each frame in turn. Each yielded `rgba` is a fresh copy. */
export function* decodeGifFrames(bytes: Uint8Array): Generator<GifFrame, void, unknown> {
  const gif = parseGif(bytes);
  const { width, height } = gif;
  const canvas = new Uint8ClampedArray(width * height * 4);
  let restore: Uint8ClampedArray | null = null;
  for (let index = 0; index < gif.frames.length; index++) {
    const d = gif.frames[index];
    if (d.disposal === 3) restore = canvas.slice();
    const indices = lzw(bytes, d.dataStart + 1, bytes[d.dataStart], d.w * d.h);
    // interlaced rows arrive in four passes; map stored row → real row
    const rowOf: number[] = [];
    if (d.interlaced) for (const [startRow, step] of INTERLACE) for (let r = startRow; r < d.h; r += step) rowOf.push(r);
    for (let row = 0; row < d.h; row++) {
      const y = d.y + (d.interlaced ? rowOf[row] : row);
      if (y >= height) continue;
      for (let col = 0; col < d.w; col++) {
        const x = d.x + col;
        if (x >= width) continue;
        const ci = indices[row * d.w + col];
        if (ci === d.transparent || ci * 3 + 2 >= d.palette.length) continue;
        const o = (y * width + x) * 4;
        canvas[o] = d.palette[ci * 3];
        canvas[o + 1] = d.palette[ci * 3 + 1];
        canvas[o + 2] = d.palette[ci * 3 + 2];
        canvas[o + 3] = 255;
      }
    }
    yield { index, rgba: canvas.slice(), delayMs: d.delayMs };
    if (d.disposal === 2) {
      for (let y = d.y; y < Math.min(height, d.y + d.h); y++) canvas.fill(0, (y * width + d.x) * 4, (y * width + Math.min(width, d.x + d.w)) * 4);
    } else if (d.disposal === 3 && restore) {
      canvas.set(restore);
    }
  }
}

import { inflateSync } from 'fflate';

/** FlateDecode. Skips the zlib header and ignores the checksum, which some writers get wrong. */
export function inflate(data: Uint8Array): Uint8Array {
  const zlib = data.length > 2 && (data[0] & 0x0f) === 8 && ((data[0] << 8) | data[1]) % 31 === 0;
  return inflateSync(zlib ? data.subarray(2) : data);
}

export interface PredictorParams {
  predictor: number;
  colors: number;
  bpc: number;
  columns: number;
}

/** Undoes a FlateDecode/LZWDecode predictor: 2 = TIFF, 10–15 = PNG row filters */
export function unpredict(data: Uint8Array, { predictor, colors, bpc, columns }: PredictorParams): Uint8Array {
  if (predictor < 2) return data;
  const rowBytes = Math.ceil((colors * bpc * columns) / 8);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  if (predictor === 2) {
    if (bpc !== 8) throw new Error(`TIFF predictor with ${bpc}-bit samples`);
    const out = data.slice();
    for (let row = 0; row + rowBytes <= out.length; row += rowBytes) {
      for (let i = colors; i < rowBytes; i++) out[row + i] = (out[row + i] + out[row + i - colors]) & 0xff;
    }
    return out;
  }
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let y = 0; y < rows; y++) {
    const type = data[y * (rowBytes + 1)];
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y ? out[dst - rowBytes + i] : 0;
      const c = y && i >= bpp ? out[dst - rowBytes + i - bpp] : 0;
      let v = data[src + i];
      if (type === 1) v += a;
      else if (type === 2) v += b;
      else if (type === 3) v += (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}

/**
 * Packed samples → one byte per sample (w × h × comps). 16-bit keeps the high
 * byte; 1/2/4-bit values are stretched to 0–255 when `scale`, else kept as-is (palette indices).
 */
export function unpack(raw: Uint8Array, width: number, height: number, comps: number, bpc: number, scale = true): Uint8Array {
  const out = new Uint8Array(width * height * comps);
  const rowBytes = Math.ceil((width * comps * bpc) / 8);
  const perRow = width * comps;
  if (bpc === 8 && raw.length >= rowBytes * height) {
    out.set(raw.subarray(0, out.length));
    return out;
  }
  const max = (1 << Math.min(bpc, 8)) - 1;
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    for (let i = 0; i < perRow; i++) {
      let v: number;
      if (bpc === 16) v = raw[row + i * 2] ?? 0;
      else if (bpc === 8) v = raw[row + i] ?? 0;
      else {
        const bit = i * bpc;
        v = ((raw[row + (bit >> 3)] ?? 0) >> (8 - bpc - (bit & 7))) & max;
        if (scale) v = Math.round((v * 255) / max);
      }
      out[y * perRow + i] = v;
    }
  }
  return out;
}

/** Nearest-neighbour resize of a one-channel plane, for soft masks stored at another size */
export function resizePlane(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[sy * sw + Math.min(sw - 1, Math.floor((x * sw) / dw))];
  }
  return out;
}

/** Pads short data with zeros (truncated streams are common) */
export function ensureLength(data: Uint8Array, length: number): Uint8Array {
  if (data.length >= length) return data;
  const out = new Uint8Array(length);
  out.set(data);
  return out;
}

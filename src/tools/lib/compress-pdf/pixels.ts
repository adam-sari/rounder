/** RGBA pixels; ImageData without needing a browser */
export interface Pixels {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface JpegInfo {
  width: number;
  height: number;
  components: number;
  /** bits per sample */
  precision: number;
  /** frame type: 0 baseline, 1 extended, 2 progressive (others are rarely decodable) */
  frame: number;
}

/** Reads a JPEG's frame header, or null when the bytes aren't a JPEG we can read */
export function jpegInfo(b: Uint8Array): JpegInfo | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i++; // fill byte
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null; // image data before any frame header
    const len = (b[i + 2] << 8) | b[i + 3];
    // SOF0–SOF15, except DHT (c4), JPG (c8) and DAC (cc)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 >= b.length) return null;
      return { precision: b[i + 4], height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], components: b[i + 9], frame: m - 0xc0 };
    }
    i += 2 + len;
  }
  return null;
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Undoes PNG row filters (FlateDecode /Predictor 10–15): every row starts with
 * a filter-type byte. Returns null on an unknown filter type.
 */
export function unpredictPng(src: Uint8Array, rowBytes: number, bpp: number): Uint8Array | null {
  const stride = rowBytes + 1;
  const rows = Math.floor(src.length / stride);
  const out = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const s = r * stride + 1;
    const o = r * rowBytes;
    const type = src[s - 1];
    for (let x = 0; x < rowBytes; x++) {
      const raw = src[s + x];
      const a = x >= bpp ? out[o + x - bpp] : 0;
      const up = r ? out[o - rowBytes + x] : 0;
      const c = r && x >= bpp ? out[o - rowBytes + x - bpp] : 0;
      switch (type) {
        case 0: out[o + x] = raw; break;
        case 1: out[o + x] = raw + a; break;
        case 2: out[o + x] = raw + up; break;
        case 3: out[o + x] = raw + ((a + up) >> 1); break;
        case 4: out[o + x] = raw + paeth(a, up, c); break;
        default: return null;
      }
    }
  }
  return out;
}

/** 8-bit gray or RGB samples → opaque RGBA */
export function toRgba(samples: Uint8Array, width: number, height: number, components: 1 | 3): Pixels {
  const n = width * height;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0, j = 0; i < n; i++, j += components) {
    data[i * 4] = samples[j];
    data[i * 4 + 1] = samples[j + (components === 3 ? 1 : 0)];
    data[i * 4 + 2] = samples[j + (components === 3 ? 2 : 0)];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/** In place, Rec. 601 luma (what most viewers use for gray) */
export function grayscale(px: Pixels) {
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
}

/** Rec. 601 luma as one 8-bit sample per pixel (DeviceGray) */
export function grayPlane(px: Pixels) {
  const d = px.data;
  const out = new Uint8Array(px.width * px.height);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  return out;
}

/**
 * Charts, diagrams, line art and bilevel scans have few distinct colors and get
 * blotchy as JPEG, so they stay lossless. Checks an even sample of pixels.
 */
export function isFlatGraphic(px: Pixels, components: 1 | 3) {
  const limit = components === 1 ? 16 : 256;
  const n = px.width * px.height;
  const step = Math.max(1, Math.floor(n / 65_536));
  const seen = new Set<number>();
  for (let i = 0; i < n; i += step) {
    const j = i * 4;
    seen.add((px.data[j] << 16) | (px.data[j + 1] << 8) | px.data[j + 2]);
    if (seen.size > limit) return false;
  }
  return true;
}

/**
 * The size an image should shrink to so it keeps `dpi` when drawn at up to
 * `maxSidePt` points on its longest side (no image is drawn bigger than its
 * page). Null when it's already near or below that.
 */
export function targetSize(width: number, height: number, maxSidePt: number, dpi: number): { width: number; height: number } | null {
  const limit = Math.ceil((maxSidePt / 72) * dpi);
  const scale = limit / Math.max(width, height);
  // a resample for less than 10% isn't worth the softening
  if (scale >= 0.9) return null;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/*
 * Lossless metadata removal. Each rewriter walks the container's segments or
 * chunks and copies the ones that carry pixels or decoding info byte for byte,
 * so the image itself is never re-encoded.
 */

export type StripKind = 'jpeg' | 'png' | 'webp';

export interface StripOptions {
  /** keep the color profile so colors look the same (default true) */
  keepIcc?: boolean;
  /** write back a tiny EXIF holding only the rotation tag when the photo needs it (default true) */
  keepOrientation?: boolean;
}

export interface Found {
  label: string;
  bytes: number;
  kept: boolean;
}

export interface StripResult {
  bytes: Uint8Array<ArrayBuffer>;
  /** metadata blocks in the original, in the order first seen */
  found: Found[];
  /** EXIF orientation of the original (1 when absent) */
  orientation: number;
  /** true when a minimal rotation-only EXIF was written back */
  wroteOrientation: boolean;
  /** the original EXIF as a TIFF stream, for reading its tags */
  exif?: Uint8Array;
}

export function stripMetadata(src: Uint8Array, kind: StripKind, opts: StripOptions = {}): StripResult {
  const o = { keepIcc: opts.keepIcc ?? true, keepOrientation: opts.keepOrientation ?? true };
  if (kind === 'jpeg') return stripJpeg(src, o);
  if (kind === 'png') return stripPng(src, o);
  return stripWebp(src, o);
}

type Opts = Required<StripOptions>;

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));
const has = (b: Uint8Array, at: number, s: string) => at + s.length <= b.length && ascii(b, at, s.length) === s;

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** collects found blocks, merging repeats (e.g. several XMP segments) into one entry */
function tally() {
  const map = new Map<string, Found>();
  return {
    add(label: string, bytes: number, kept: boolean) {
      const f = map.get(label);
      if (f) f.bytes += bytes;
      else map.set(label, { label, bytes, kept });
    },
    list: () => [...map.values()],
  };
}

/** Reads IFD0's Orientation tag (0x0112) from a TIFF stream, with or without the "Exif\0\0" prefix */
export function readOrientation(tiff: Uint8Array): number {
  if (has(tiff, 0, 'Exif\0\0')) tiff = tiff.subarray(6);
  if (tiff.length < 8) return 1;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const v = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const ifd = v.getUint32(4, le);
  if (ifd + 2 > tiff.length) return 1;
  const count = v.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > tiff.length) break;
    if (v.getUint16(e, le) === 0x0112) {
      // a SHORT sits in the first two bytes of the value field
      const value = v.getUint16(e + 8, le);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** A 26-byte big-endian TIFF stream whose only tag is Orientation */
export function orientationTiff(orientation: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(26);
  const v = new DataView(b.buffer);
  b.set([0x4d, 0x4d, 0x00, 0x2a]);
  v.setUint32(4, 8); // IFD0 offset
  v.setUint16(8, 1); // one entry
  v.setUint16(10, 0x0112);
  v.setUint16(12, 3); // SHORT
  v.setUint32(14, 1);
  v.setUint16(18, orientation);
  // bytes 22–25: no next IFD
  return b;
}

/* ---------------------------------- JPEG ---------------------------------- */

const XMP_IDS = ['http://ns.adobe.com/xap/1.0/\0', 'http://ns.adobe.com/xmp/extension/\0'];

/** the next marker after entropy-coded data, skipping stuffed bytes (FF 00) and restart markers */
function nextMarker(b: Uint8Array, from: number) {
  let i = from;
  for (;;) {
    i = b.indexOf(0xff, i);
    if (i < 0 || i + 1 >= b.length) return b.length;
    const m = b[i + 1];
    if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) i += 2;
    else if (m === 0xff) i += 1;
    else return i;
  }
}

function stripJpeg(src: Uint8Array, o: Opts): StripResult {
  if (src[0] !== 0xff || src[1] !== 0xd8) throw new Error('This is not a valid JPEG file.');
  const keep: Uint8Array[] = [src.subarray(0, 2)];
  const found = tally();
  let orientation = 1;
  let exif: Uint8Array | undefined;
  let pos = 2;

  while (pos + 1 < src.length) {
    if (src[pos] !== 0xff) throw new Error('This JPEG file is damaged.');
    const marker = src[pos + 1];
    if (marker === 0xff) {
      pos++; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      keep.push(src.subarray(pos, pos + 2));
      pos += 2;
      // anything after the end of the image: motion-photo video, HDR gain maps, vendor trailers
      if (pos < src.length) found.add('Trailing data', src.length - pos, false);
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push(src.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (pos + 4 > src.length) throw new Error('This JPEG file is cut off.');
    const end = pos + 2 + ((src[pos + 2] << 8) | src[pos + 3]);
    if (end > src.length) throw new Error('This JPEG file is cut off.');
    const body = pos + 4;
    const size = end - pos;

    if (marker === 0xda) {
      // start of scan: copy the header and its compressed data up to the next marker
      const next = nextMarker(src, end);
      keep.push(src.subarray(pos, next));
      pos = next;
      continue;
    }

    // JFIF headers can carry a thumbnail of the original shot: keep the 18-byte header, drop the pixels
    if (marker === 0xe0 && has(src, body, 'JFIF\0') && size > 18) {
      const jfif = src.slice(pos, pos + 18);
      jfif[2] = 0;
      jfif[3] = 16;
      jfif[16] = jfif[17] = 0; // thumbnail width × height
      found.add('Thumbnail', size - 18, false);
      keep.push(jfif);
      pos = end;
      continue;
    }

    let label: string | undefined;
    let kept = false;
    if (marker === 0xe0) {
      if (has(src, body, 'JFXX\0')) label = 'Thumbnail';
    } else if (marker === 0xe1) {
      if (has(src, body, 'Exif\0')) {
        label = 'EXIF';
        exif ??= src.subarray(body + 6, end);
        orientation = readOrientation(exif);
      } else label = XMP_IDS.some((id) => has(src, body, id)) ? 'XMP' : 'APP1 data';
    } else if (marker === 0xe2) {
      if (has(src, body, 'ICC_PROFILE\0')) {
        label = 'ICC profile';
        kept = o.keepIcc;
      } else label = has(src, body, 'MPF\0') ? 'Extra images (MPF)' : 'APP2 data';
    } else if (marker === 0xed) label = 'IPTC';
    else if (marker === 0xfe) label = 'Comment';
    // APP0 (JFIF) and APP14 (Adobe color transform) describe how to decode; other APPn are vendor metadata
    else if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee) label = `APP${marker - 0xe0} data`;

    if (label) found.add(label, size, kept);
    if (!label || kept) keep.push(src.subarray(pos, end));
    pos = end;
  }

  const wroteOrientation = o.keepOrientation && orientation !== 1;
  if (wroteOrientation) {
    const tiff = orientationTiff(orientation);
    const app1 = concat([new Uint8Array([0xff, 0xe1, 0, 2 + 6 + tiff.length]), new TextEncoder().encode('Exif\0\0'), tiff]);
    // JFIF wants APP0 straight after SOI
    keep.splice(keep[1]?.[1] === 0xe0 ? 2 : 1, 0, app1);
  }
  return { bytes: concat(keep), found: found.list(), orientation, wroteOrientation, exif };
}

/* ----------------------------------- PNG ---------------------------------- */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP: Record<string, string> = {
  eXIf: 'EXIF',
  tEXt: 'Text',
  zTXt: 'Text',
  iTXt: 'Text',
  tIME: 'Timestamp',
  caBX: 'Content credentials',
};

let crcTable: Uint32Array | undefined;

export function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function stripPng(src: Uint8Array, o: Opts): StripResult {
  if (!PNG_SIG.every((b, i) => src[i] === b)) throw new Error('This is not a valid PNG file.');
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const keep: Uint8Array[] = [src.subarray(0, 8)];
  const found = tally();
  let orientation = 1;
  let exif: Uint8Array | undefined;
  let pos = 8;

  for (;;) {
    if (pos + 12 > src.length) throw new Error('This PNG file is cut off.');
    const len = v.getUint32(pos);
    const type = ascii(src, pos + 4, 4);
    const end = pos + 12 + len;
    if (end > src.length) throw new Error('This PNG file is cut off.');
    const data = src.subarray(pos + 8, pos + 8 + len);

    let label = PNG_DROP[type];
    let kept = false;
    if (type === 'iTXt' && has(data, 0, 'XML:com.adobe.xmp\0')) label = 'XMP';
    if (type === 'eXIf') {
      exif ??= data;
      orientation = readOrientation(data);
    }
    if (type === 'iCCP') {
      label = 'ICC profile';
      kept = o.keepIcc;
    }

    if (label) found.add(label, end - pos, kept);
    if (!label || kept) keep.push(src.subarray(pos, end));
    pos = end;
    if (type === 'IEND') break;
  }
  if (pos < src.length) found.add('Trailing data', src.length - pos, false);

  const wroteOrientation = o.keepOrientation && orientation !== 1;
  // straight after IHDR, so it comes before the image data
  if (wroteOrientation) keep.splice(2, 0, pngChunk('eXIf', orientationTiff(orientation)));
  return { bytes: concat(keep), found: found.list(), orientation, wroteOrientation, exif };
}

/* ---------------------------------- WebP ---------------------------------- */

const VP8X_ICC = 0x20;
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function riffChunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(8 + data.length + (data.length & 1));
  out.set(new TextEncoder().encode(type));
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

function stripWebp(src: Uint8Array, o: Opts): StripResult {
  if (!has(src, 0, 'RIFF') || !has(src, 8, 'WEBP')) throw new Error('This is not a valid WebP file.');
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const riffEnd = Math.min(src.length, 8 + v.getUint32(4, true));
  const keep: Uint8Array[] = [];
  const found = tally();
  let orientation = 1;
  let exif: Uint8Array | undefined;
  let vp8x: Uint8Array | undefined;
  let pos = 12;

  while (pos + 8 <= riffEnd) {
    const type = ascii(src, pos, 4);
    const len = v.getUint32(pos + 4, true);
    const end = Math.min(riffEnd, pos + 8 + len + (len & 1));
    const data = src.subarray(pos + 8, Math.min(end, pos + 8 + len));

    let label: string | undefined;
    let kept = false;
    if (type === 'EXIF') {
      label = 'EXIF';
      // some writers keep JPEG's "Exif\0\0" prefix
      exif ??= has(data, 0, 'Exif\0\0') ? data.subarray(6) : data;
      orientation = readOrientation(exif);
    } else if (type === 'XMP ') label = 'XMP';
    else if (type === 'ICCP') {
      label = 'ICC profile';
      kept = o.keepIcc;
    }

    if (label) found.add(label, end - pos, kept);
    if (!label || kept) {
      const chunk = src.slice(pos, end);
      if (type === 'VP8X') vp8x = chunk;
      keep.push(chunk);
    }
    pos = end;
  }
  if (riffEnd < src.length) found.add('Trailing data', src.length - riffEnd, false);

  // only the extended format (VP8X) can carry metadata, so only it can carry a rotation tag back
  const wroteOrientation = o.keepOrientation && orientation !== 1 && !!vp8x;
  if (wroteOrientation) keep.push(riffChunk('EXIF', orientationTiff(orientation)));
  if (vp8x) {
    let flags = vp8x[8] & ~(VP8X_EXIF | VP8X_XMP);
    if (!o.keepIcc) flags &= ~VP8X_ICC;
    if (wroteOrientation) flags |= VP8X_EXIF;
    vp8x[8] = flags;
  }

  const body = concat(keep);
  const header = new Uint8Array(12);
  header.set(src.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return { bytes: concat([header, body]), found: found.list(), orientation, wroteOrientation, exif };
}

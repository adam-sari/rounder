/*
 * Stamps a resolution into a JPG or PNG so "print at actual size" comes out at
 * the right physical size. Pixels are untouched; only a header changes.
 */

/** JFIF APP0 density: units 1 = dots per inch */
function jpegDpi(bytes: Uint8Array, dpi: number) {
  const density = [dpi >> 8, dpi & 255, dpi >> 8, dpi & 255];
  const isJfif = bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.subarray(6, 11)) === 'JFIF\0';
  if (isJfif) {
    const out = bytes.slice();
    out[13] = 1;
    out.set(density, 14);
    return out;
  }
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, ...density, 0, 0];
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2));
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

let table: Uint32Array | undefined;
function crc32(bytes: Uint8Array) {
  table ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Replaces any pHYs chunk with one right after IHDR (pixels per metre) */
function pngDpi(bytes: Uint8Array, dpi: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));

  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  for (let at = 8; at < bytes.length; ) {
    const end = at + 12 + view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type !== 'pHYs') parts.push(bytes.subarray(at, end));
    if (type === 'IHDR') parts.push(chunk);
    at = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function setDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDpi(bytes, dpi);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return pngDpi(bytes, dpi);
  return bytes;
}

export async function withDpi(blob: Blob, dpi: number) {
  const bytes = setDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: blob.type });
}

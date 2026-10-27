/* Pure helpers for turning photos into pages (no pdf-lib, safe for the main thread) */

/** EXIF orientation (1–8) of a JPEG; 1 when it has none */
export function jpegOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) break; // image data starts: no more metadata
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10; // TIFF header, after "Exif\0\0"
      const le = b[t] === 0x49;
      const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) => (le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
      const ifd = t + u32(t + 4);
      const count = ifd + 2 <= b.length ? u16(ifd) : 0;
      for (let k = 0; k < count; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 12 > b.length) break;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** Orientations a page rotation can show correctly; the mirrored ones (2, 4, 5, 7) need redrawing */
export const ORIENTATION_ROTATION: Record<number, number> = { 1: 0, 3: 180, 6: 90, 8: 270 };

export function hasAlpha(data: Uint8ClampedArray) {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}

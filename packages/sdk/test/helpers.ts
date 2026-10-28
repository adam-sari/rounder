import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll } from 'vitest';

export const REPO = join(import.meta.dirname, '../../..');
export const FX = join(REPO, 'tests/fixtures');

if (!existsSync(join(import.meta.dirname, '../dist/index.mjs'))) throw new Error('Build the SDK first: npm run build -w @roundertools/sdk');

/** a fresh folder for one test file, removed afterwards */
export function workDir() {
  const dir = mkdtempSync(join(import.meta.dirname, 'tmp-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** a TIFF EXIF block holding only an orientation tag, as a JPEG APP1 segment */
export function exifSegment(orientation: number, extra = 'Rounder test camera') {
  const text = new TextEncoder().encode(`${extra}\0`);
  const tiff = new Uint8Array(8 + 2 + 12 * 2 + 4 + text.length);
  const v = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  v.setUint32(4, 8, true);
  v.setUint16(8, 2, true);
  // Make (0x010f), ASCII, stored after the IFD
  v.setUint16(10, 0x010f, true);
  v.setUint16(12, 2, true);
  v.setUint32(14, text.length, true);
  v.setUint32(18, 8 + 2 + 24 + 4, true);
  // Orientation (0x0112), SHORT
  v.setUint16(22, 0x0112, true);
  v.setUint16(24, 3, true);
  v.setUint32(26, 1, true);
  v.setUint16(30, orientation, true);
  v.setUint32(34, 0, true);
  tiff.set(text, 38);
  const body = new Uint8Array([...new TextEncoder().encode('Exif\0\0'), ...tiff]);
  return new Uint8Array([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
}

/** inserts an APP1 segment right after a JPEG's SOI marker */
export const withExif = (jpeg: Uint8Array, orientation: number) => new Uint8Array([...jpeg.subarray(0, 2), ...exifSegment(orientation), ...jpeg.subarray(2)]);

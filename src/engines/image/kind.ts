import type { formatInfo } from './types';

// Sniffing and format mapping, apart from the worker pool in client.ts so code without a DOM can use them too.

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'bmp' | 'svg' | 'tiff' | 'ico' | 'unknown';

/** Identifies an image by its first bytes, since file names and types can lie */
export async function imageKind(file: Blob & { name?: string }): Promise<ImageKind> {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const ascii = new TextDecoder('latin1').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (ascii.startsWith('\x89PNG')) return 'png';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('BM')) return 'bmp';
  if (ascii.startsWith('II*\0') || ascii.startsWith('MM\0*')) return 'tiff';
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'ico';
  if (ascii.slice(4, 8) === 'ftyp') {
    const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    const brands = ascii.slice(8, Math.min(boxSize, 64));
    if (/avi[fs]/.test(brands)) return 'avif';
    if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brands)) return 'heic';
  }
  if (/^\s*(<\?xml|<svg|<!--)/i.test(ascii) || file.type === 'image/svg+xml' || file.name?.toLowerCase().endsWith('.svg')) return 'svg';
  return 'unknown';
}

/** A file's original format, mapped to the closest output we can write */
export function outputFormatFor(kind: ImageKind): keyof typeof formatInfo {
  return kind === 'jpeg' || kind === 'png' || kind === 'webp' || kind === 'avif' ? kind : kind === 'heic' ? 'jpeg' : 'png';
}

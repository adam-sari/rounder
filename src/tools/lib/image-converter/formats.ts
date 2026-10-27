import type { OutputFormat } from '@/engines/image/types';

/** source formats that get their own variant page */
export type SourceFormat = 'heic' | 'jpg' | 'png' | 'webp' | 'avif' | 'gif' | 'bmp';

export const sourceInfo: Record<SourceFormat, { label: string; accept: string; noun: string }> = {
  heic: { label: 'HEIC', accept: '.heic,.heif,image/heic,image/heif', noun: 'HEIC photos' },
  jpg: { label: 'JPG', accept: '.jpg,.jpeg,image/jpeg', noun: 'JPGs' },
  png: { label: 'PNG', accept: '.png,image/png', noun: 'PNGs' },
  webp: { label: 'WebP', accept: '.webp,image/webp', noun: 'WebP images' },
  avif: { label: 'AVIF', accept: '.avif,image/avif', noun: 'AVIF images' },
  gif: { label: 'GIF', accept: '.gif,image/gif', noun: 'GIFs' },
  bmp: { label: 'BMP', accept: '.bmp,image/bmp', noun: 'BMPs' },
};

// any image still gets through; HEIC files often arrive with no mime type, hence the extensions
const ANY_IMAGE = 'image/*,.heic,.heif,.avif';

/** File-picker filter with the page's own format listed first */
export function acceptFor(from?: SourceFormat) {
  return from ? `${sourceInfo[from].accept},${ANY_IMAGE}` : ANY_IMAGE;
}

export function dropTitle(from?: SourceFormat) {
  return from ? `Drop ${sourceInfo[from].noun} here` : 'Drop images here';
}

/** a sensible starting quality per lossy format (the scales differ: AVIF 65 looks like JPG 90) */
export const defaultQuality: Record<OutputFormat, number> = { jpeg: 90, png: 100, webp: 85, avif: 65 };

export const maxSizes: [number, string][] = [
  [0, 'full'],
  [3840, '4K'],
  [2560, '2560'],
  [1920, '1920'],
  [1280, '1280'],
];

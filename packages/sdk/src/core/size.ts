import { z } from 'zod';
import { targetFromHash } from '@/tools/lib/exact-size/target';
import { RounderError } from './errors';

export const SIZE_PATTERN = /^\s*\d+(\.\d+)?\s*(b|kb|mb|gb|kib|mib|gib)?\s*$/i;

/**
 * "100kb", "2.5mb" (decimal, 1 KB = 1,000 bytes, like the site's exact-size targets), "100KiB" (binary) or a byte count.
 * Returns bytes.
 */
export function parseSize(value: string | number): number {
  if (typeof value === 'number') {
    if (!(value > 0) || !Number.isFinite(value)) throw new RounderError('invalid-options', `${value} isn't a size. Use bytes or a size like 100kb or 2mb.`);
    return Math.floor(value);
  }
  const kb = targetFromHash(value.replace(/\s+/g, ''));
  if (kb !== null) return Math.round(kb * 1000);
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|gb|kib|mib|gib)?\s*$/i.exec(value);
  const unit = m?.[2]?.toLowerCase() ?? 'b';
  const factor: Record<string, number> = { b: 1, gb: 1e9, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 };
  const bytes = m ? Number(m[1]) * factor[unit] : NaN;
  if (!(bytes > 0)) throw new RounderError('invalid-options', `"${value}" isn't a size. Use something like 100kb, 2.5mb or 100KiB.`);
  return Math.floor(bytes);
}

/** A size option: a byte count or text like "100kb" / "2mb" */
export const size = () =>
  z.union([z.number().int().positive(), z.string().regex(SIZE_PATTERN, 'Use a size like 100kb, 2.5mb or 100KiB')]);

/** "1.2 MB" / "118 KB" in decimal units, like the site */
export function formatSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 1 : 2)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

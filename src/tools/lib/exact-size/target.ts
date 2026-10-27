// Shared by the exact-size presets (compress a PDF, image or video to a size). Targets count 1 KB as 1,000 bytes and
// 1 MB as 1,000,000, so a file under the limit also passes upload forms that count 1,024.

export const KB = 1000;
export const MB = 1_000_000;

/** a size limit in bytes: at most `max`, at least `min` (either may be left out) */
export interface Limit {
  min?: number;
  max?: number;
}

const plain = (n: number, digits: number) => String(Math.floor(n * 10 ** digits) / 10 ** digits);

/** "9.6 KB", "98 KB", "1.24 MB" in the decimal units the targets use (rounded down, so a fit never reads as over) */
export function sizeText(bytes: number, digits?: number): string {
  if (bytes >= MB) return `${plain(bytes / MB, digits ?? 2)} MB`;
  return `${plain(bytes / KB, digits ?? (bytes < 10 * KB ? 1 : 0))} KB`;
}

/** a size that would print the same as a limit it misses gets more digits: never "100 KB ✗ over 100 KB" */
function sharp(bytes: number, limits: (number | undefined)[]) {
  const text = sizeText(bytes);
  return limits.some((l) => l !== undefined && l !== bytes && sizeText(l) === text) ? sizeText(bytes, bytes >= MB ? 3 : 1) : text;
}

/** "under 100 KB", "20–50 KB", "at least 20 KB" */
export function limitText({ min, max }: Limit): string {
  if (min && max) {
    const [a, b] = [sizeText(min), sizeText(max)];
    return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
  }
  if (max) return `under ${sizeText(max)}`;
  return min ? `at least ${sizeText(min)}` : 'any size';
}

export type Miss = 'over' | 'under';

/** whether a result meets the limit, as one line: "98 KB ✓ fits under 100 KB" / "112 KB ✗ over 100 KB" */
export function verdict(bytes: number, limit: Limit): { ok: boolean; miss?: Miss; text: string } {
  const size = sharp(bytes, [limit.min, limit.max]);
  if (limit.max !== undefined && bytes > limit.max) return { ok: false, miss: 'over', text: `${size} ✗ over ${sizeText(limit.max)}` };
  if (limit.min !== undefined && bytes < limit.min) return { ok: false, miss: 'under', text: `${size} ✗ under the ${sizeText(limit.min)} minimum` };
  const how = limit.min && limit.max ? 'within ' : limit.max ? 'fits ' : '';
  return { ok: true, text: `${size} ✓ ${how}${limitText(limit)}` };
}

/**
 * A target typed into the page address, e.g. /compress-pdf#150kb or #target=2mb, in KB. Only the hash, so no new URLs
 * get crawled; the hub page links to the main tools this way for sizes that have no preset page.
 */
export function targetFromHash(hash: string): number | null {
  let text: string;
  try {
    text = decodeURIComponent(hash).trim();
  } catch {
    return null; // a stray "%" in a hand-typed address
  }
  const m = /^#?(?:target=)?(\d+(?:\.\d+)?)\s*(kb|mb)$/i.exec(text);
  if (!m) return null;
  const kb = Number(m[1]) * (m[2].toLowerCase() === 'mb' ? 1000 : 1);
  return kb > 0 && kb <= 10_000_000 ? kb : null;
}

/** how many parts of at most `target` bytes a `size`-byte file needs, keeping 10% spare for each part's own overhead */
export const partsFor = (size: number, target: number) => Math.max(2, Math.ceil(size / (target * 0.9)));

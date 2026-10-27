import { zipSync } from 'fflate';

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

/** "holiday.HEIC" + "jpg" → "holiday.jpg" */
export function withExtension(name: string, ext: string) {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

/** "holiday.jpg" + "-small" → "holiday-small.jpg" */
export function withSuffix(name: string, suffix: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  // revoking straight away can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Gives clashing names a " (2)" suffix so nothing is overwritten inside a zip */
export function uniqueNames(names: string[]) {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count ? withSuffix(name, ` (${count + 1})`) : name;
  });
}

/** Zips files without recompressing (images and media are already compressed) */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const names = uniqueNames(files.map((f) => f.name));
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const [i, f] of files.entries()) {
    entries[names[i]] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

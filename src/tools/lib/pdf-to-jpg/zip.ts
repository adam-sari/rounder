import { Zip, ZipPassThrough } from 'fflate';
import { uniqueNames } from '../files';

/**
 * Stores files in a zip without recompressing them, one file per task so the
 * checksum work on hundreds of large images never blocks the page for long.
 */
export async function zipBlobs(files: { name: string; blob: Blob }[], onProgress?: (done: number) => void): Promise<Blob> {
  const names = uniqueNames(files.map((f) => f.name));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let failure = null as Error | null;
  const zip = new Zip((err, data) => {
    if (err) failure = err;
    else chunks.push(data as Uint8Array<ArrayBuffer>);
  });
  for (const [i, f] of files.entries()) {
    const entry = new ZipPassThrough(names[i]);
    zip.add(entry);
    entry.push(new Uint8Array(await f.blob.arrayBuffer()), true);
    if (failure) throw failure;
    onProgress?.(i + 1);
    await new Promise((r) => setTimeout(r));
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(chunks, { type: 'application/zip' });
}

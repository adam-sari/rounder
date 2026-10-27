import * as Comlink from 'comlink';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { deflateLevel, zipTime, type Level } from './zip';

export interface ZipEntry {
  blob: Blob;
  path: string;
  /** last modified, ms */
  mtime?: number;
}

const api = {
  /** streams every file through fflate one chunk at a time, so big files never sit in memory twice */
  async zip(entries: ZipEntry[], level: Level, onProgress: (bytesRead: number) => void): Promise<Blob> {
    const parts: Blob[] = [];
    let failure: Error | null = null;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const zip = new Zip((err, chunk, final) => {
      if (err) failure = err;
      // a Blob copies the bytes now, so fflate is free to reuse its buffers
      else parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
      if (final || err) finish();
    });

    let read = 0;
    let reported = 0;
    for (const e of entries) {
      const deflate = deflateLevel(level, e.path);
      const file = deflate ? new ZipDeflate(e.path, { level: deflate }) : new ZipPassThrough(e.path);
      file.mtime = zipTime(e.mtime ?? 0);
      zip.add(file);
      const reader = e.blob.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        file.push(value);
        read += value.length;
        if (read - reported > 1 << 20) onProgress((reported = read));
        if (failure) throw failure;
      }
      file.push(new Uint8Array(0), true);
    }
    zip.end();
    await finished;
    if (failure) throw failure;
    onProgress(read);
    return new Blob(parts, { type: 'application/zip' });
  },
};

export type ZipWorker = typeof api;
Comlink.expose(api);

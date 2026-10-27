import * as Comlink from 'comlink';
import type { Level } from './zip';
import type { ZipEntry, ZipWorker } from './worker';

export type { ZipEntry };

/** Builds a ZIP in a worker of its own; aborting stops it at once */
export async function buildZip(entries: ZipEntry[], level: Level, onProgress: (bytesRead: number) => void, signal?: AbortSignal) {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'zip' });
  const stopped = new Promise<never>((_, reject) =>
    signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }),
  );
  try {
    const api = Comlink.wrap<ZipWorker>(worker);
    return await Promise.race([api.zip(entries, level, Comlink.proxy(onProgress)), stopped]);
  } finally {
    worker.terminate();
  }
}

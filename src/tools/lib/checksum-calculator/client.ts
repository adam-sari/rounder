import type { Algo } from './algorithms';
import type { HashMessage, HashRequest } from './worker';

/**
 * Hashes a file with one algorithm in its own worker, so several algorithms run in
 * parallel on separate cores. Aborting terminates the worker straight away.
 */
export function hashFile(file: Blob, algo: Algo, onProgress: (p: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const done = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      done();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort);
    worker.onmessage = (e: MessageEvent<HashMessage>) => {
      const msg = e.data;
      if ('progress' in msg) return onProgress(msg.progress);
      done();
      if ('hex' in msg) resolve(msg.hex);
      else reject(new Error(msg.error));
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || 'Hashing failed.'));
    };
    worker.postMessage({ file, algo } satisfies HashRequest);
  });
}

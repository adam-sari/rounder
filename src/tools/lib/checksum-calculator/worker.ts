/// <reference lib="webworker" />
import { createHasher, type Algo } from './algorithms';
import { toHex } from './block';

export interface HashRequest {
  file: Blob;
  algo: Algo;
}
export type HashMessage = { progress: number } | { hex: string } | { error: string };

const CHUNK = 8 * 1024 * 1024;

self.onmessage = async (e: MessageEvent<HashRequest>) => {
  const { file, algo } = e.data;
  try {
    const hasher = createHasher(algo);
    // read slice by slice so a 10 GB file never has to fit in memory
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      hasher.update(new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer()));
      self.postMessage({ progress: Math.min(1, (offset + CHUNK) / file.size) } satisfies HashMessage);
    }
    self.postMessage({ hex: toHex(hasher.digest()) } satisfies HashMessage);
  } catch (err) {
    self.postMessage({ error: (err as Error)?.message || 'Could not read this file.' } satisfies HashMessage);
  }
};

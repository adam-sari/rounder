import type { Found, ScanRequest } from './worker';

export type { Found };

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (f: Found[]) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; found?: Found[]; error?: string }>) => {
    const job = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (e.data.found) job?.resolve(e.data.found);
    else job?.reject(new Error(e.data.error));
  };
  w.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'The scanner stopped unexpectedly.'));
    pending.clear();
    w.terminate();
    worker = undefined;
  };
  return (worker = w);
}

/** Finds every QR code and barcode in an image, off the main thread. The pixels are transferred, not copied. */
export function scanPixels(image: ImageData, live = false): Promise<Found[]> {
  const w = getWorker();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const data = image.data as Uint8ClampedArray<ArrayBuffer>;
    const request: ScanRequest = { id, width: image.width, height: image.height, data, live };
    w.postMessage(request, [data.buffer]);
  });
}

/** Shuts the worker down, e.g. when the tool goes away */
export function closeScanner() {
  worker?.terminate();
  worker = undefined;
  for (const job of pending.values()) job.reject(new DOMException('Closed', 'AbortError'));
  pending.clear();
}

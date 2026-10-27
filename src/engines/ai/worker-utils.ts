import * as Comlink from 'comlink';
import { AiError, aiError, toAiError } from './errors';

/*
 * Model work belongs in a Web Worker so the page never freezes. The pattern (see lab/lab.worker.ts):
 *
 *   // my-tool.worker.ts
 *   const api = {
 *     async load(o: { variant?: string; device?: Device }, onProgress: OnProgress) {
 *       const r = await loadTransformersPipeline('depth-estimation', 'depth-anything-v2-small', { ...o, onProgress: throttleProgress(onProgress) });
 *       estimator = r.value;
 *       return { device: r.device, variant: r.variant };
 *     },
 *     async run(image: ImageData) { … return Comlink.transfer(result, [result.data.buffer]); },
 *   };
 *   exposeWorker(api);
 *   export type MyToolWorker = typeof api;
 *
 *   // in the island
 *   const worker = modelWorker<MyToolWorker>(() => new Worker(new URL('./my-tool.worker.ts', import.meta.url), { type: 'module' }));
 *   await worker.call((api) => api.load({ variant }, proxy(onProgress)), signal);   // abort → worker is terminated
 *   const out = await worker.call((api) => api.run(imageData));
 *
 * Cancelling terminates the worker (the only way to stop a download or a long inference mid-way);
 * the next call starts a fresh one, which loads the model again, from the cache this time.
 */

export { proxy, transfer } from 'comlink';

/** Exposes a worker API; errors reach the page as AiError with their `code` intact */
export function exposeWorker<T extends object>(api: T): T {
  const handler = Comlink.transferHandlers.get('throw')!;
  Comlink.transferHandlers.set('throw', {
    canHandle: handler.canHandle,
    serialize(thrown: unknown) {
      const value = (thrown as { value: unknown }).value;
      const ai = toAiError(value);
      const [wire, transferables] = handler.serialize({ value: ai });
      (wire as { value: Record<string, unknown> }).value.code = ai.code;
      // keep the technical cause readable in the page's console
      console.error(value);
      return [wire, transferables];
    },
    deserialize: handler.deserialize,
  });
  Comlink.expose(api);
  return api;
}

export interface ModelWorker<T> {
  /** the worker's API; starts the worker on first use */
  readonly api: Comlink.Remote<T>;
  /** runs one call; aborting the signal (or the worker crashing) terminates the worker and rejects with AiError */
  call<R>(fn: (api: Comlink.Remote<T>) => Promise<R>, signal?: AbortSignal): Promise<R>;
  terminate(): void;
}

export function modelWorker<T>(spawn: () => Worker): ModelWorker<T> {
  let worker: Worker | null = null;
  let remote: Comlink.Remote<T> | null = null;
  let crashed: Promise<never> = new Promise(() => {});

  const self: ModelWorker<T> = {
    get api() {
      if (!remote) {
        const w = (worker = spawn());
        remote = Comlink.wrap<T>(w);
        // an uncaught error or a failed module load kills pending calls silently otherwise
        crashed = new Promise((_, reject) => w.addEventListener('error', (e) => reject(toAiError(new Error(e.message || 'worker failed'))), { once: true }));
        crashed.catch(() => self.terminate());
      }
      return remote;
    },
    async call(fn, signal) {
      signal?.throwIfAborted();
      let onAbort = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => {
          self.terminate();
          reject(aiError('aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      try {
        const api = self.api;
        return await Promise.race([fn(api), aborted, crashed]);
      } catch (err) {
        throw err instanceof AiError ? err : toAiError(err);
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
    terminate() {
      worker?.terminate();
      worker = null;
      remote = null;
    },
  };
  return self;
}

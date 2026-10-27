/// <reference lib="webworker" />
// OPUS-MT translation models (one per direction) through transformers.js, off the main thread.
import { loadTransformersPipeline } from '@/engines/ai/load';
import { totalDownloadSize, type Device, type ModelKey } from '@/engines/ai/models';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { exposeWorker } from '@/engines/ai/worker-utils';
import type { Hop } from './languages';

type Translate = ((texts: string[]) => Promise<{ translation_text: string }[]>) & { dispose(): Promise<unknown> };
interface Want {
  key: ModelKey;
  variant?: string;
  device?: Device;
}

/** loaded models, least recently used first; each holds ~110 MB of memory */
const pipes = new Map<ModelKey, Promise<Translate>>();
const KEEP = 3;

function pipe({ key, variant, device }: Want, onProgress?: OnProgress): Promise<Translate> {
  let p = pipes.get(key);
  pipes.delete(key);
  if (!p) {
    p = loadTransformersPipeline('translation', key, { variant, device, onProgress }).then((r) => r.value as unknown as Translate);
    p.catch(() => pipes.delete(key));
  }
  pipes.set(key, p);
  for (const [old, q] of pipes) {
    if (pipes.size <= KEEP) break;
    pipes.delete(old);
    q.then((t) => t.dispose()).catch(() => {});
  }
  return p;
}

const api = {
  /** loads the models of a route one after the other, as one progress bar */
  async load(models: Want[], onProgress: OnProgress) {
    const report = throttleProgress(onProgress);
    const sizes = models.map((m) => totalDownloadSize(m.key, m.variant!));
    let before = 0;
    for (const [i, m] of models.entries()) {
      const after = sizes.slice(i + 1).reduce((a, b) => a + b, 0);
      let total = sizes[i];
      const last = i === models.length - 1;
      await pipe(m, (p) => {
        total = p.total;
        report({ ...p, phase: last ? p.phase : 'download', loaded: before + p.loaded, total: before + p.total + after });
      });
      before += total;
    }
    return { device: 'wasm' as Device };
  },

  /** translates a batch through every hop of the route (loading a model again if needed) */
  async translate(hops: Hop[], texts: string[]) {
    let out = texts;
    for (const h of hops) {
      const t = await pipe({ key: h.key });
      out = (await t(out.map((s) => (h.prefix ?? '') + s))).map((r) => r.translation_text);
    }
    return out;
  },
};

exposeWorker(api);
export type TranslatorWorker = typeof api;

/// <reference lib="webworker" />
// Depth Anything V2 small through transformers.js, off the main thread.
import { loadTransformersPipeline, type LoadOptions } from '@/engines/ai/load';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { loadTransformers } from '@/engines/ai/runtime';
import { exposeWorker, transfer } from '@/engines/ai/worker-utils';

type Estimator = (image: unknown) => Promise<{ depth: { data: Uint8Array; width: number; height: number } }>;
let estimate: Estimator | null = null;

const api = {
  async load(o: Pick<LoadOptions, 'device' | 'variant'>, onProgress: OnProgress) {
    const r = await loadTransformersPipeline('depth-estimation', 'depth-anything-v2-small', { ...o, onProgress: throttleProgress(onProgress) });
    estimate = r.value as unknown as Estimator;
    return { device: r.device, variant: r.variant };
  },

  /** RGBA in; one byte per pixel at the same size out (255 = nearest), min–max normalised */
  async run(image: ImageData) {
    if (!estimate) throw new Error('load() first');
    const { RawImage } = await loadTransformers();
    const start = performance.now();
    const { depth } = await estimate(new RawImage(image.data, image.width, image.height, 4));
    const data = new Uint8Array(depth.data);
    return transfer({ data, width: depth.width, height: depth.height, ms: performance.now() - start }, [data.buffer]);
  },
};

exposeWorker(api);
export type DepthWorker = typeof api;

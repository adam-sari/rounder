/// <reference lib="webworker" />
// The reference pattern for a tool's model worker: load() with progress, run() with transfer.
import { detectDevice } from '../device';
import { loadTransformersPipeline, type LoadOptions } from '../load';
import { throttleProgress, type OnProgress } from '../progress';
import { loadTransformers } from '../runtime';
import { exposeWorker, transfer } from '../worker-utils';

type Cutout = (image: unknown) => Promise<{ data: Uint8ClampedArray; width: number; height: number }>;
let cutout: Cutout | null = null;

const api = {
  /** detection inside a worker, to compare with the page's */
  device: detectDevice,

  async load(o: Pick<LoadOptions, 'device' | 'variant'>, onProgress: OnProgress) {
    const r = await loadTransformersPipeline('background-removal', 'modnet', { ...o, onProgress: throttleProgress(onProgress) });
    cutout = r.value as unknown as Cutout;
    return { device: r.device, variant: r.variant, ms: r.ms };
  },

  /** RGBA in; the same pixels with the person matte as alpha out */
  async run(image: ImageData) {
    if (!cutout) throw new Error('load() first');
    const { RawImage } = await loadTransformers();
    const start = performance.now();
    const out = await cutout(new RawImage(image.data, image.width, image.height, 4));
    const result = new ImageData(new Uint8ClampedArray(out.data), out.width, out.height);
    return transfer({ image: result, ms: performance.now() - start }, [result.data.buffer]);
  },
};

exposeWorker(api);
export type LabWorker = typeof api;

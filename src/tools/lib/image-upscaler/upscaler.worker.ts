/// <reference lib="webworker" />
// Runs Swin2SR one tile at a time; the page plans the tiles, blends them and shows them as they land.
import { loadTransformersModel, type LoadOptions } from '@/engines/ai/load';
import type { ModelKey } from '@/engines/ai/models';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { loadTransformers, type TransformersModule } from '@/engines/ai/runtime';
import { exposeWorker, transfer } from '@/engines/ai/worker-utils';
import { fromReconstruction, toPixelValues, type Pixels } from './tiles';

interface OutTensor {
  data: Float32Array;
  dims: number[];
  dispose(): void;
}
interface Upscaler {
  model: (inputs: Record<string, unknown>) => Promise<{ reconstruction: OutTensor }>;
  dispose(): Promise<void>;
}

let upscaler: Upscaler | null = null;

/**
 * WebGPU problems (a missing kernel, a buffer over the GPU's limit, fp16 overflow) only show on the
 * first run, not when the session opens. One run at the real tile size inside the loader lets it
 * fall back to the CPU before any tile is lost; it also compiles the shaders, so the ETA is fair.
 */
async function warmUp(pipe: Upscaler, tf: TransformersModule, tile: number) {
  const n = tile * tile;
  const values = Float32Array.from({ length: n * 3 }, (_, i) => ((i % n) % tile) / tile);
  const { reconstruction } = await pipe.model({ pixel_values: new tf.Tensor('float32', values, [1, 3, tile, tile]) });
  const ok = reconstruction.data.every(Number.isFinite);
  reconstruction.dispose();
  if (!ok) throw new Error('WebGPU returned invalid numbers');
}

const api = {
  /** `tile` is the GPU tile size, used for the warm-up run on WebGPU */
  async load(key: ModelKey, o: Pick<LoadOptions, 'device' | 'variant'>, tile: number, onProgress: OnProgress) {
    await upscaler?.dispose();
    upscaler = null;
    const r = await loadTransformersModel(
      key,
      async (tf, options, m) => {
        const pipe = (await tf.pipeline('image-to-image', m.repo, options)) as unknown as Upscaler;
        if (options.device === 'webgpu')
          await warmUp(pipe, tf, tile).catch(async (err) => {
            await pipe.dispose();
            throw err;
          });
        return pipe;
      },
      { ...o, onProgress: throttleProgress(onProgress) },
    );
    upscaler = r.value;
    return { device: r.device, variant: r.variant };
  },

  /** one RGBA tile in, the same tile upscaled (opaque RGBA) out */
  async upscale(tile: Pixels, scale: number) {
    if (!upscaler) throw new Error('load() first');
    const { Tensor } = await loadTransformers();
    const input = toPixelValues(tile);
    const { reconstruction } = await upscaler.model({ pixel_values: new Tensor('float32', input.values, [1, 3, input.height, input.width]) });
    const [, , ph, pw] = reconstruction.dims;
    const out = fromReconstruction(reconstruction.data, pw, ph, tile.width * scale, tile.height * scale);
    reconstruction.dispose();
    return transfer(out, [out.data.buffer]);
  },
};

exposeWorker(api);
export type UpscalerWorker = typeof api;

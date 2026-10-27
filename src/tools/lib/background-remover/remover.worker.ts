/// <reference lib="webworker" />
// Runs BiRefNet lite or MODNet off the main thread and returns a full-resolution alpha mask.
import type { InferenceSession } from 'onnxruntime-web';
import { aiError } from '@/engines/ai/errors';
import { createOrtSession, loadTransformersModel, type LoadOptions } from '@/engines/ai/load';
import type { Device, ModelKey } from '@/engines/ai/models';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { loadTransformers, type TransformersModule } from '@/engines/ai/runtime';
import { exposeWorker, transfer } from '@/engines/ai/worker-utils';
import { birefnet, type Predict } from './birefnet';
import { downsample, fitSize, maskVerdict, refineMatte, toProbabilities, WORK_SIZE, type MaskVerdict } from './matte';

type Tensor = InstanceType<TransformersModule['Tensor']>;

let current: { key: ModelKey; device: Device; variant: string; predict: Predict; dispose: () => Promise<unknown> } | null = null;

const api = {
  /** loads a model, replacing the previous one; a no-op when it is already loaded. Returns where it really runs (after any CPU fallback) */
  async load(key: ModelKey, o: Pick<LoadOptions, 'device' | 'variant'>, onProgress?: OnProgress) {
    if (current?.key === key) return { device: current.device, variant: current.variant };
    await current?.dispose();
    current = null;
    const opts = { ...o, onProgress: onProgress && throttleProgress(onProgress) };
    if (key === 'birefnet-lite') {
      const r = await createOrtSession(key, opts);
      const { session, ort } = r.value;
      current = { key, device: r.device, variant: r.variant, predict: birefnet(session, ort), dispose: () => session.release() };
      return { device: r.device, variant: r.variant };
    }
    // MODNet: transformers.js (its processor keeps the aspect ratio, sides a multiple of 32)
    const r = await loadTransformersModel(key, (tf, options, m) => Promise.all([tf.AutoModel.from_pretrained(m.repo, options), tf.AutoProcessor.from_pretrained(m.repo, options)]), opts);
    const [model, processor] = r.value;
    const tf = await loadTransformers();
    const predict: Predict = async (rgba, w, h) => {
      const { pixel_values } = (await processor(new tf.RawImage(rgba, w, h, 4))) as { pixel_values: Tensor };
      const session = (model as unknown as { sessions: Record<string, InferenceSession> }).sessions.model;
      const outputs = (await model({ [session.inputNames[0]]: pixel_values })) as Record<string, Tensor>;
      const out = outputs[session.outputNames[0]];
      const [mh, mw] = out.dims.slice(-2);
      // copy, so the mask outlives the tensors
      const mask = toProbabilities(new Float32Array(out.data as Float32Array));
      for (const t of [pixel_values, ...Object.values(outputs)]) t.dispose();
      return { mask, mw, mh };
    };
    current = { key, device: r.device, variant: r.variant, predict, dispose: () => model.dispose() };
    return { device: r.device, variant: r.variant };
  },

  /** RGBA in (any size); the subject's alpha at the same size out, or why there is none */
  async run(image: ImageData): Promise<{ verdict: MaskVerdict; alpha: ReturnType<typeof refineMatte> | null; width: number; height: number }> {
    if (!current) throw new Error('load() first');
    const { width: w, height: h, data } = image;
    const [ww, wh] = fitSize(w, h, WORK_SIZE);
    const work = ww === w && wh === h ? data : downsample(data, w, h, ww, wh, 4);
    const { mask, mw, mh } = await current.predict(work, ww, wh);
    // fp16 math on some graphics cards overflows, and a broken GPU kernel returns noise: never pass either off as a cut-out
    const verdict = maskVerdict(mask);
    if (verdict === 'invalid') throw aiError('failed');
    if (verdict !== 'ok') return { verdict, alpha: null, width: w, height: h };
    const alpha = refineMatte(mask, mw, mh, work, ww, wh, data, w, h);
    return transfer({ verdict, alpha, width: w, height: h }, [alpha.buffer]);
  },
};

exposeWorker(api);
export type RemoverWorker = typeof api;

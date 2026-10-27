/// <reference lib="webworker" />
// One model, one device, one deterministic input per worker (a fresh worker per run, so each one
// picks its own ORT build). The page compares the outputs; see AiParity.svelte.
import type { InferenceSession, Tensor as OrtTensor } from 'onnxruntime-web';
import { DemucsProcessor } from 'demucs-web';
import { birefnet } from '@/tools/lib/background-remover/birefnet';
import { downsample, fitSize, toProbabilities, WORK_SIZE } from '@/tools/lib/background-remover/matte';
import { crop, toPixelValues } from '@/tools/lib/image-upscaler/tiles';
import { SIDE } from '@/tools/lib/object-remover/geometry';
import { toPlanar } from '@/tools/lib/object-remover/pixels';
import { MODEL_SIZE, modelInput } from '@/tools/lib/photo-colorizer/lab';
import { createOrtSession, loadTransformersModel, loadTransformersPipeline, type LoadOptions } from '../load';
import type { ModelKey } from '../models';
import { loadTransformers, type TransformersModule } from '../runtime';
import { exposeWorker, transfer } from '../worker-utils';

export interface ParityInput {
  /** RGBA photo, any size */
  image: ImageData;
  /** 16 kHz mono speech */
  speech: Float32Array;
  /** 44.1 kHz stereo, one Demucs segment long */
  music: [Float32Array, Float32Array];
}
export type ParityConfig = Pick<LoadOptions, 'device' | 'variant' | 'gpu' | 'patch'>;
export interface ParityOutput {
  /** numbers to compare, or text when the model writes text */
  values?: Float32Array;
  text?: string;
  device: string;
  variant: string;
  loadMs: number;
  runMs: number;
  error?: string;
}

type AnyTensor = { data: ArrayLike<number>; dims: number[]; type?: string; location?: string; ort_tensor?: OrtTensor; getData?: () => Promise<ArrayLike<number>> };

const halfToFloat = (h: number) => {
  const e = (h >> 10) & 31;
  const m = h & 1023;
  const v = e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15);
  return h & 0x8000 ? -v : v;
};

/** any tensor (transformers.js or ORT, CPU or GPU, fp16 or fp32) as a fresh Float32Array */
async function read(t: AnyTensor): Promise<Float32Array> {
  const inner = (t.ort_tensor ?? t) as AnyTensor;
  const data = inner.location && inner.location !== 'cpu' ? await inner.getData!() : inner.data;
  if (inner.type === 'float16' && data instanceof Uint16Array) return Float32Array.from(data, halfToFloat);
  return Float32Array.from(data as ArrayLike<number>, Number);
}

/** The same 512² square every image case starts from: the photo's center, scaled */
function square(img: ImageData, side: number): ImageData {
  const s = Math.min(img.width, img.height);
  const src = new OffscreenCanvas(img.width, img.height);
  src.getContext('2d')!.putImageData(img, 0, 0);
  const ctx = new OffscreenCanvas(side, side).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, side, side);
  return ctx.getImageData(0, 0, side, side);
}

type Run = (input: ParityInput) => Promise<{ values?: Float32Array; text?: string }>;
type Case = (o: ParityConfig) => Promise<{ device: string; variant: string; run: Run }>;

/** background-remover "Fast": AutoModel + AutoProcessor at WORK_SIZE, the raw mask as probabilities */
const matte =
  (key: ModelKey): Case =>
  async (o) => {
    const r = await loadTransformersModel(key, (tf, opts, m) => Promise.all([tf.AutoModel.from_pretrained(m.repo, opts), tf.AutoProcessor.from_pretrained(m.repo, opts)]), o);
    const [model, processor] = r.value;
    const tf = await loadTransformers();
    return {
      ...r,
      async run({ image }) {
        const [ww, wh] = fitSize(image.width, image.height, WORK_SIZE);
        const work = downsample(image.data, image.width, image.height, ww, wh, 4);
        const { pixel_values } = (await processor(new tf.RawImage(work, ww, wh, 4))) as { pixel_values: AnyTensor };
        const session = (model as unknown as { sessions: Record<string, InferenceSession> }).sessions.model;
        const outputs = (await model({ [session.inputNames[0]]: pixel_values })) as Record<string, AnyTensor>;
        return { values: toProbabilities(await read(outputs[session.outputNames[0]])) };
      },
    };
  };

/** image-upscaler: one 128² tile through the model, the raw reconstruction */
const upscale =
  (key: ModelKey): Case =>
  async (o) => {
    const r = await loadTransformersModel(key, (tf, opts, m) => tf.pipeline('image-to-image', m.repo, opts), o);
    const { Tensor } = await loadTransformers();
    const pipe = r.value as unknown as { model: (i: Record<string, unknown>) => Promise<{ reconstruction: AnyTensor }> };
    return {
      ...r,
      async run({ image }) {
        const sq = square(image, 512);
        const input = toPixelValues(crop({ data: sq.data, width: 512, height: 512 }, 192, 96, 128, 128));
        const { reconstruction } = await pipe.model({ pixel_values: new Tensor('float32', input.values, [1, 3, input.height, input.width]) });
        return { values: await read(reconstruction) };
      },
    };
  };

/** object-remover: a 512² crop with a square hole in the middle, the raw fill */
const inpaint =
  (key: 'migan' | 'lama'): Case =>
  async (o) => {
    const r = await createOrtSession(key, o);
    const { session, ort } = r.value;
    return {
      ...r,
      async run({ image }) {
        const sq = square(image, SIDE);
        const n = SIDE * SIDE;
        const hole = Uint8Array.from({ length: n }, (_, i) => +(Math.abs((i % SIDE) - 256) < 60 && Math.abs(Math.floor(i / SIDE) - 200) < 60));
        const feeds =
          key === 'lama'
            ? {
                image: new ort.Tensor('float32', toPlanar(sq.data, new Float32Array(3 * n), 1 / 255), [1, 3, SIDE, SIDE]),
                mask: new ort.Tensor('float32', Float32Array.from(hole), [1, 1, SIDE, SIDE]),
              }
            : {
                image: new ort.Tensor('uint8', toPlanar(sq.data, new Uint8Array(3 * n)), [1, 3, SIDE, SIDE]),
                mask: new ort.Tensor('uint8', Uint8Array.from(hole, (v) => (v ? 0 : 255)), [1, 1, SIDE, SIDE]),
              };
        const out = await session.run(feeds);
        return { values: await read(out[session.outputNames[0]] as unknown as AnyTensor) };
      },
    };
  };

const CASES: Record<string, Case> = {
  /** background-remover "Best": the tool's own raw-ORT path */
  async 'birefnet-lite'(o) {
    const r = await createOrtSession('birefnet-lite', o);
    const predict = birefnet(r.value.session, r.value.ort);
    return {
      ...r,
      async run({ image }) {
        const [ww, wh] = fitSize(image.width, image.height, WORK_SIZE);
        return { values: (await predict(downsample(image.data, image.width, image.height, ww, wh, 4), ww, wh)).mask };
      },
    };
  },
  modnet: matte('modnet'),
  'swin2sr-x2-light': upscale('swin2sr-x2-light'),
  'swin2sr-x4-realworld': upscale('swin2sr-x4-realworld'),
  migan: inpaint('migan'),
  lama: inpaint('lama'),

  async 'ddcolor-tiny'(o) {
    const r = await createOrtSession('ddcolor-tiny', { ...o, sessionOptions: { logSeverityLevel: 3 } });
    const { session, ort } = r.value;
    return {
      ...r,
      async run({ image }) {
        const sq = square(image, MODEL_SIZE);
        const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', modelInput(sq), [1, 3, MODEL_SIZE, MODEL_SIZE]) });
        return { values: await read(out[session.outputNames[0]] as unknown as AnyTensor) };
      },
    };
  },

  /** alt-text-generator: the vision encoder's features, plus a greedy caption */
  async 'florence2-base'(o) {
    type Florence = [InstanceType<TransformersModule['Florence2ForConditionalGeneration']>, InstanceType<TransformersModule['Florence2Processor']>];
    const r = await loadTransformersModel<Florence>(
      'florence2-base',
      (tf, opts, m) => Promise.all([tf.Florence2ForConditionalGeneration.from_pretrained(m.repo, opts), tf.Florence2Processor.from_pretrained(m.repo, opts)]) as Promise<Florence>,
      o,
    );
    const [model, processor] = r.value;
    const { RawImage } = await loadTransformers();
    return {
      ...r,
      async run({ image }) {
        const sq = square(image, 768);
        const img = new RawImage(sq.data, 768, 768, 4);
        const task = '<CAPTION>';
        const inputs = await processor(img, task);
        const features = await (model as unknown as { encode_image(i: unknown): Promise<AnyTensor> }).encode_image(inputs);
        const values = await read(features);
        const ids = await model.generate({ ...inputs, max_new_tokens: 40, num_beams: 1 });
        const [text] = processor.batch_decode(ids as Parameters<typeof processor.batch_decode>[0], { skip_special_tokens: true });
        return { values, text };
      },
    };
  },

  async 'depth-anything-v2-small'(o) {
    const r = await loadTransformersPipeline('depth-estimation', 'depth-anything-v2-small', o);
    const { RawImage } = await loadTransformers();
    const estimate = r.value as unknown as (i: unknown) => Promise<{ predicted_depth: AnyTensor }>;
    return {
      ...r,
      async run({ image }) {
        const { predicted_depth } = await estimate(new RawImage(image.data, image.width, image.height, 4));
        return { values: await read(predicted_depth) };
      },
    };
  },

  ...Object.fromEntries(
    (['whisper-tiny', 'whisper-base', 'whisper-large-turbo'] as const).map((key) => [
      key,
      (async (o) => {
        const r = await loadTransformersPipeline('automatic-speech-recognition', key, o);
        const p = r.value;
        return {
          ...r,
          /** audio-to-text: the encoder's output, plus the English transcript */
          async run({ speech }) {
            const { input_features } = await p.processor(speech);
            const enc = await (p.model as unknown as { _encode_input(s: string, i: unknown, o: string): Promise<AnyTensor> })._encode_input('model', { input_features }, 'last_hidden_state');
            const values = await read(enc);
            const out = (await p(speech, { language: 'en', task: 'transcribe' } as never)) as { text: string };
            return { values, text: out.text.trim() };
          },
        };
      }) satisfies Case,
    ]),
  ),

  async 'opus-mt-en-es'(o) {
    const r = await loadTransformersPipeline('translation', 'opus-mt-en-es', o);
    const t = r.value as unknown as (s: string[]) => Promise<{ translation_text: string }[]>;
    return {
      ...r,
      run: async () => ({ text: (await t(['The weather was lovely, so we walked along the river and talked about our plans for the summer.']))[0].translation_text }),
    };
  },

  /** text-summarizer fallback: a short greedy reply */
  async 'qwen3.5-0.8b'(o) {
    const r = await loadTransformersPipeline('text-generation', 'qwen3.5-0.8b', o);
    const gen = r.value as unknown as (chat: unknown, o: unknown) => Promise<{ generated_text: { content: string }[] }[]>;
    return {
      ...r,
      async run() {
        const chat = [{ role: 'user', content: 'Summarize in one sentence: The city council voted on Tuesday to turn the old rail yard into a public park with a playground, a community garden and a small outdoor theatre. Work starts next spring.' }];
        const [out] = await gen(chat, { max_new_tokens: 40, do_sample: false });
        return { text: out.generated_text.at(-1)!.content.trim() };
      },
    };
  },

  /** vocal-remover: one Demucs segment, the vocals stem (left channel) */
  async demucs(o) {
    const r = await createOrtSession('demucs', { ...o, sessionOptions: { graphOptimizationLevel: 'basic' } });
    const processor = new DemucsProcessor({ ort: r.value.ort });
    processor.session = r.value.session;
    return {
      ...r,
      async run({ music: [left, right] }) {
        const out = await processor.separate(left, right);
        return { values: Float32Array.from(out.vocals.left) };
      },
    };
  },
};

const api = {
  /** `twice` times a second run, after shaders are compiled and memory is set up */
  async run(key: string, o: ParityConfig, input: ParityInput, twice = false): Promise<ParityOutput> {
    const t0 = performance.now();
    try {
      const c = await CASES[key](o);
      const t1 = performance.now();
      let out = await c.run(input);
      let t2 = t1;
      if (twice) [t2, out] = [performance.now(), await c.run(input)];
      const result = { ...out, device: c.device, variant: c.variant, loadMs: t1 - t0, runMs: performance.now() - t2 };
      return out.values ? transfer(result, [out.values.buffer]) : result;
    } catch (err) {
      // the technical cause, not the friendly AiError message
      let e = err as { message?: string; cause?: unknown };
      while (e.cause) e = e.cause as typeof e;
      return { device: o.device!, variant: o.variant!, loadMs: 0, runMs: 0, error: String(e.message ?? e) };
    }
  },
};

exposeWorker(api);
export type ParityWorker = typeof api;

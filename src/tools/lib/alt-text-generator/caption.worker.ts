/// <reference lib="webworker" />
// Florence-2 in a worker: load() once with progress, then caption() one picture at a time.
import { releaseProxy } from 'comlink';
import { loadTransformersModel, type LoadOptions } from '@/engines/ai/load';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { loadTransformers, type TransformersModule } from '@/engines/ai/runtime';
import { exposeWorker } from '@/engines/ai/worker-utils';

type Opts = Pick<LoadOptions, 'device' | 'variant'>;
type Florence = [InstanceType<TransformersModule['Florence2ForConditionalGeneration']>, InstanceType<TransformersModule['Florence2Processor']>];

let loading: ReturnType<typeof load> | null = null;

function load(o: Opts, onProgress?: OnProgress) {
  return loadTransformersModel<Florence>(
    'florence2-base',
    // from_pretrained() is typed with the base classes
    (tf, options, m) => Promise.all([tf.Florence2ForConditionalGeneration.from_pretrained(m.repo, options), tf.Florence2Processor.from_pretrained(m.repo, options)]) as Promise<Florence>,
    { ...o, onProgress: onProgress && throttleProgress(onProgress) },
  );
}

/** a cancelled caption terminates the worker, so a fresh one loads the model again (from the cache) on first use */
function ensure(o: Opts, onProgress?: OnProgress) {
  loading ??= load(o, onProgress).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

const api = {
  async load(o: Opts, onProgress: OnProgress) {
    const r = await ensure(o, onProgress);
    return { device: r.device, variant: r.variant };
  },

  /** a picture already scaled to the model's 768×768 input; streams words to onText as they're written */
  async caption(picture: ImageBitmap, task: string, maxTokens: number, o: Opts, onText?: (text: string) => void) {
    const {
      value: [model, processor],
    } = await ensure(o);
    const { RawImage, TextStreamer } = await loadTransformers();
    const { width, height } = picture;
    const ctx = new OffscreenCanvas(width, height).getContext('2d')!;
    // transparent PNGs: the model sees white behind them, not black
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(picture, 0, 0);
    picture.close();
    const image = new RawImage(ctx.getImageData(0, 0, width, height).data, width, height, 4);
    const inputs = await processor(image, task);
    const streamer = onText && new TextStreamer(processor.tokenizer!, { skip_prompt: true, skip_special_tokens: true, callback_function: onText });
    // greedy decoding: the config's 3 beams cost 3× for captions that barely differ
    const ids = await model.generate({ ...inputs, max_new_tokens: maxTokens, num_beams: 1, streamer }).finally(() => {
      // onText is a Comlink proxy with its own MessagePort: close it, or a big batch leaves one open per picture
      (onText as Partial<Record<typeof releaseProxy, () => void>> | undefined)?.[releaseProxy]?.();
    });
    const [text] = processor.batch_decode(ids as Parameters<typeof processor.batch_decode>[0], { skip_special_tokens: false });
    const out = processor.post_process_generation(text, task, image.size)[task];
    return typeof out === 'string' ? out : '';
  },
};

exposeWorker(api);
export type CaptionWorker = typeof api;

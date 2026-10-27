/// <reference lib="webworker" />
// The local fallback model (Qwen3.5 0.8B, q4f16 on WebGPU) with streamed output and a stop switch.
import type { InterruptableStoppingCriteria, TextGenerationPipeline } from '@huggingface/transformers';
import { loadTransformersPipeline, type LoadOptions } from '@/engines/ai/load';
import type { Device } from '@/engines/ai/models';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { loadTransformers, type TransformersModule } from '@/engines/ai/runtime';
import { exposeWorker } from '@/engines/ai/worker-utils';

type Chat = { role: 'system' | 'user' | 'assistant'; content: string }[];

let tf: TransformersModule | null = null;
let generator: TextGenerationPipeline | null = null;
let loaded: { device: Device; variant: string } | null = null;
/** one generation at a time: a new request waits for the one being stopped to end */
let queue: Promise<unknown> = Promise.resolve();
/** each request's own stop switch, by the id the page gave it */
const stoppers = new Map<number, InterruptableStoppingCriteria>();

const api = {
  async load(o: Pick<LoadOptions, 'device' | 'variant'>, onProgress: OnProgress) {
    if (generator && loaded && (!o.variant || o.variant === loaded.variant)) return loaded;
    await generator?.dispose();
    generator = loaded = null;
    const r = await loadTransformersPipeline('text-generation', 'qwen3.5-0.8b', { ...o, onProgress: throttleProgress(onProgress) });
    tf = await loadTransformers();
    generator = r.value as TextGenerationPipeline;
    return (loaded = { device: r.device, variant: r.variant });
  },

  /** false in a fresh worker (after a crash), so the page loads the model again */
  isLoaded() {
    return !!generator;
  },

  /** Streams the reply through onText (text pieces) and returns it whole */
  async generate(id: number, chat: Chat, o: { temperature: number; maxTokens: number }, onText: (delta: string) => void) {
    if (!tf) throw new Error('load() first');
    const { InterruptableStoppingCriteria, TextStreamer } = tf;
    const stopper = new InterruptableStoppingCriteria();
    stoppers.set(id, stopper);
    const turn = queue.then(async () => {
      if (stopper.interrupted) return '';
      if (!generator) throw new Error('load() first');
      const sampling = o.temperature > 0 ? { do_sample: true, temperature: o.temperature, top_p: 0.8, top_k: 20 } : { do_sample: false };
      const [out] = (await generator(chat, {
        max_new_tokens: o.maxTokens,
        ...sampling,
        streamer: new TextStreamer(generator.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: onText }),
        stopping_criteria: stopper,
      })) as { generated_text: Chat }[];
      return out.generated_text.at(-1)?.content ?? '';
    });
    queue = turn.catch(() => {});
    try {
      return await turn;
    } finally {
      stoppers.delete(id);
    }
  },

  /** Ends request `id` after its next token (or before it starts); what was written so far is returned */
  stop(id: number) {
    stoppers.get(id)?.interrupt();
  },
};

exposeWorker(api);
export type LocalWorker = typeof api;

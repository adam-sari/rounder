/// <reference lib="webworker" />
// Whisper in a worker: loads the model once (swapping it when another is asked for), detects
// the language, and transcribes one window at a time with word timings, streaming the text.
import { loadTransformersPipeline } from '@/engines/ai/load';
import { throttleProgress, type OnProgress } from '@/engines/ai/progress';
import { loadTransformers } from '@/engines/ai/runtime';
import { exposeWorker } from '@/engines/ai/worker-utils';
import type { WhisperSpec } from './engine';

type Asr = Awaited<ReturnType<typeof loadTransformersPipeline<'automatic-speech-recognition'>>>['value'];
interface WordChunk {
  text: string;
  timestamp: [number, number | null];
}

let asr: Asr | null = null;
let loaded = '';
let ranOn: WhisperSpec['device'] = 'wasm';

async function ensure(spec: WhisperSpec, onProgress?: OnProgress) {
  const id = `${spec.key}/${spec.variant}/${spec.device}`;
  if (!asr || loaded !== id) {
    await asr?.dispose();
    asr = null;
    const r = await loadTransformersPipeline('automatic-speech-recognition', spec.key, { variant: spec.variant, device: spec.device, onProgress: onProgress && throttleProgress(onProgress) });
    [asr, loaded, ranOn] = [r.value, id, r.device];
  }
  return asr;
}

const api = {
  async load(spec: WhisperSpec, onProgress: OnProgress) {
    await ensure(spec, onProgress);
    return { device: ranOn };
  },

  /**
   * Whisper's own guess: the first token it writes after "start of transcript" names the language.
   * Like OpenAI's detect_language, only language tokens may win that first step.
   */
  async detectLanguage(spec: WhisperSpec, audio: Float32Array): Promise<string> {
    const p = await ensure(spec);
    const { input_features } = await p.processor(audio);
    const config = p.model.generation_config as unknown as { decoder_start_token_id: number; lang_to_id: Record<string, number> };
    const languages = new Set(Object.values(config.lang_to_id));
    const onlyLanguages = (_ids: unknown, logits: { data: Float32Array }) => {
      for (let i = 0; i < logits.data.length; i++) if (!languages.has(i)) logits.data[i] = -Infinity;
      return logits;
    };
    const out = (await p.model.generate({ inputs: input_features, decoder_input_ids: [config.decoder_start_token_id], max_new_tokens: 1, logits_processor: [onlyLanguages] } as never)) as unknown as { tolist(): bigint[][] };
    const id = Number(out.tolist()[0].at(-1));
    const token = Object.entries(config.lang_to_id).find(([, v]) => v === id)?.[0];
    return token ? token.slice(2, -2) : 'en';
  },

  /**
   * One window (≤30 s of 16 kHz mono) → words with times relative to the window. `onText` gets
   * the text so far and how far into the window it has got, a few times a second.
   */
  async transcribe(spec: WhisperSpec, audio: Float32Array, o: { language: string; task: 'transcribe' | 'translate' }, onText: (text: string, at: number) => void) {
    const p = await ensure(spec);
    const tf = await loadTransformers();
    let text = '';
    let at = 0;
    let last = 0;
    const push = () => {
      const now = performance.now();
      if (now - last < 150) return;
      last = now;
      onText(text, at);
    };
    const streamer = new tf.WhisperTextStreamer(p.tokenizer as never, {
      skip_prompt: true,
      callback_function: (piece: string) => {
        text += piece;
        push();
      },
      on_chunk_end: (t: number) => {
        at = Math.max(at, t);
        push();
      },
    });
    const out = (await p(audio, { return_timestamps: 'word', language: o.language, task: o.task, streamer } as never)) as { text: string; chunks?: WordChunk[] };
    return out.chunks ?? [];
  },
};

exposeWorker(api);
export type WhisperWorker = typeof api;

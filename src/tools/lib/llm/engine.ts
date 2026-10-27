import { toAiError } from '@/engines/ai/errors';
import { proxy, type ModelWorker } from '@/engines/ai/worker-utils';
import type { LocalWorker } from './local.worker';

/*
 * One interface over the two ways the writing tools run a language model on the visitor's device:
 *   builtin  Chrome's built-in AI (Gemini Nano): Summarizer, Prompt API, Proofreader (see chrome-ai.ts)
 *   local    a small open model (Qwen3.5 0.8B) through transformers.js on WebGPU, in a worker
 * A tool calls whichever of summarize / proofread / generate the engine has, falling back to generate.
 */

export interface GenerateRequest {
  system: string;
  prompt: string;
  /** language of the user's text, from llm.language() (the built-in model wants it up front) */
  lang?: string;
  /** 0 = always the likeliest words; higher = more varied */
  temperature?: number;
  maxTokens?: number;
  /** the whole answer so far, as it streams */
  onText?: (soFar: string) => void;
  signal?: AbortSignal;
}

export interface SummarizerRequest {
  type: 'key-points' | 'tldr' | 'headline';
  length: 'short' | 'medium' | 'long';
  format: 'markdown' | 'plain-text';
  lang?: string;
  onText?: (soFar: string) => void;
  signal?: AbortSignal;
}

export interface Llm {
  engine: 'builtin' | 'local';
  /** shown to people: "Gemini Nano (built into Chrome)", "Qwen3.5 0.8B" */
  name: string;
  /** characters of user text one request holds comfortably; tools chunk longer text */
  maxChars: number;
  /** the text's language when the engine cares (built-in AI), else undefined */
  language(text: string): Promise<string | undefined>;
  generate?(r: GenerateRequest): Promise<string>;
  /** Chrome's Summarizer API */
  summarize?(text: string, r: SummarizerRequest): Promise<string>;
  /** Chrome's Proofreader API: the corrected text */
  proofread?(text: string, r: { lang?: string; signal?: AbortSignal }): Promise<string>;
}

/**
 * The local model behind a worker; stopping interrupts that request and keeps the model loaded.
 * `reload` loads the model again when the worker lost it (a fresh worker after a crash).
 */
export function localLlm(worker: ModelWorker<LocalWorker>, name: string, reload: () => Promise<unknown>): Llm {
  let ids = 0;
  return {
    engine: 'local',
    name,
    maxChars: 6000,
    language: async () => undefined,
    async generate({ system, prompt, temperature = 0, maxTokens = 1024, onText, signal }) {
      signal?.throwIfAborted();
      if (!(await worker.call((api) => api.isLoaded()))) await reload();
      signal?.throwIfAborted();
      const id = ++ids;
      let text = '';
      const stop = () => worker.api.stop(id);
      signal?.addEventListener('abort', stop, { once: true });
      try {
        const out = await worker.call((api) =>
          api.generate(
            id,
            [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
            { temperature, maxTokens },
            proxy((delta: string) => {
              text += delta;
              onText?.(text);
            }),
          ),
        );
        signal?.throwIfAborted();
        return out;
      } finally {
        signal?.removeEventListener('abort', stop);
      }
    },
  };
}

/** Too much text for one request (built-in AI); summarize() retries with smaller parts */
export const isTooLong = (err: unknown) => (err as { name?: string })?.name === 'QuotaExceededError';
export const isStopped = (err: unknown, signal?: AbortSignal) => !!signal?.aborted || (err as { name?: string })?.name === 'AbortError';

/** A message for people, whichever engine failed */
export function llmErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (isTooLong(err)) return "That's more text than the model can take in one go. Try a shorter piece.";
  if (name === 'NotAllowedError') return "Chrome wants a click before it starts its built-in AI. Press the button again.";
  if (name === 'NotSupportedError') return "Chrome's built-in AI doesn't handle this language yet. It works in English, Spanish, Japanese, German and French.";
  if (name === 'InvalidStateError') return "Chrome's built-in AI stopped. Reload the page and try again.";
  return toAiError(err).message;
}

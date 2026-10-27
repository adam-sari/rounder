/*
 * Chrome's built-in AI (Gemini Nano, on the device): Summarizer (stable since Chrome 138), the
 * Prompt API / LanguageModel (stable on the web since Chrome 148) and Proofreader (origin trial).
 * Page-side only: none of them exist in workers. Shapes follow developer.chrome.com/docs/ai
 * (Oct 2026); there are no TypeScript types for them yet, so the bits we use are declared here.
 */
import type { Llm } from './engine';

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
export type BuiltinApi = 'summarizer' | 'prompt' | 'proofreader';

interface CreateOptions {
  signal?: AbortSignal;
  monitor?: (m: EventTarget) => void;
  [option: string]: unknown;
}
interface Factory<T> {
  availability(options?: Record<string, unknown>): Promise<Availability>;
  create(options?: CreateOptions): Promise<T & { destroy(): void }>;
}
interface Builtins {
  Summarizer?: Factory<{ summarizeStreaming(text: string, o?: { signal?: AbortSignal }): ReadableStream<string> }>;
  LanguageModel?: Factory<{ promptStreaming(text: string, o?: { signal?: AbortSignal }): ReadableStream<string> }>;
  // Chrome's docs name the corrected text both correctedInput and correction
  Proofreader?: Factory<{ proofread(text: string): Promise<{ correctedInput?: string; correction?: string }> }>;
  LanguageDetector?: Factory<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> }>;
}

const builtins = () => globalThis as unknown as Builtins;
const FACTORY = { summarizer: 'Summarizer', prompt: 'LanguageModel', proofreader: 'Proofreader' } as const;
const factory = (api: BuiltinApi) => builtins()[FACTORY[api]] as Factory<object> | undefined;

/** Languages Gemini Nano reads and writes */
export const BUILTIN_LANGS = ['en', 'es', 'ja', 'de', 'fr'];

/** The language options each API wants, so Chrome knows what it will be asked */
function langOptions(api: BuiltinApi, lang = 'en'): Record<string, unknown> {
  if (api === 'prompt') return { expectedInputs: [{ type: 'text', languages: [lang] }], expectedOutputs: [{ type: 'text', languages: [lang] }] };
  if (api === 'summarizer') return { expectedInputLanguages: [lang], outputLanguage: lang };
  return { expectedInputLanguages: [lang] };
}

export async function availability(api: BuiltinApi): Promise<Availability> {
  try {
    return (await factory(api)?.availability(langOptions(api))) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

const RANK: Availability[] = ['unavailable', 'downloadable', 'downloading', 'available'];
export const bestOf = (all: Availability[]) => all.reduce<Availability>((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a), 'unavailable');

/**
 * Has Chrome fetch its model (a click must lead here: Chrome requires user activation).
 * onProgress gets 0–1. Resolves once the model is on the device.
 */
export async function downloadBuiltin(api: BuiltinApi, onProgress: (fraction: number) => void, signal: AbortSignal) {
  const instance = await factory(api)!.create({
    ...langOptions(api),
    signal,
    monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress((e as Event & { loaded: number }).loaded)),
  });
  instance.destroy();
}

/** The text's language when Gemini Nano supports it, else English */
async function detectLanguage(text: string): Promise<string> {
  const detector = builtins().LanguageDetector;
  try {
    // only when it's already on the device: create() would otherwise start a download nobody asked for
    if (!detector || (await detector.availability()) !== 'available') return 'en';
    const d = await detector.create();
    try {
      const [top] = await d.detect(text.slice(0, 2000));
      const lang = top?.detectedLanguage.split('-')[0];
      return lang && top.confidence > 0.5 && BUILTIN_LANGS.includes(lang) ? lang : 'en';
    } finally {
      d.destroy();
    }
  } catch {
    return 'en';
  }
}

/** Reads a streaming answer; chunks are deltas in current Chrome, the whole text in older builds */
async function readStream(stream: ReadableStream<string>, onText?: (soFar: string) => void): Promise<string> {
  const reader = stream.getReader();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text = text && value.startsWith(text) ? value : text + value;
    onText?.(text);
  }
}

/** An engine over the built-in APIs that are ready on this device */
export function builtinLlm(apis: BuiltinApi[]): Llm {
  const has = (api: BuiltinApi) => apis.includes(api);
  return {
    engine: 'builtin',
    name: 'Gemini Nano (built into Chrome)',
    // Gemini Nano's window is a few thousand tokens; QuotaExceededError makes summarize() halve this
    maxChars: 9000,
    language: detectLanguage,
    generate: has('prompt')
      ? async ({ system, prompt, lang, onText, signal }) => {
          const session = await builtins().LanguageModel!.create({ initialPrompts: [{ role: 'system', content: system }], ...langOptions('prompt', lang), signal });
          try {
            return await readStream(session.promptStreaming(prompt, { signal }), onText);
          } finally {
            session.destroy();
          }
        }
      : undefined,
    summarize: has('summarizer')
      ? async (text, { type, length, format, lang, onText, signal }) => {
          const summarizer = await builtins().Summarizer!.create({ type, length, format, ...langOptions('summarizer', lang), signal });
          try {
            return await readStream(summarizer.summarizeStreaming(text, { signal }), onText);
          } finally {
            summarizer.destroy();
          }
        }
      : undefined,
    proofread: has('proofreader')
      ? async (text, { lang, signal }) => {
          const proofreader = await builtins().Proofreader!.create({ ...langOptions('proofreader', lang), signal });
          try {
            const result = await proofreader.proofread(text);
            return result.correctedInput ?? result.correction ?? text;
          } finally {
            proofreader.destroy();
          }
        }
      : undefined,
  };
}

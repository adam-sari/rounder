/*
 * Chrome's (138+) and Edge's built-in Translator and LanguageDetector APIs: on-device models the
 * browser downloads and manages itself, per language pair. Desktop only for now; feature-detect.
 * https://developer.chrome.com/docs/ai/translator-api
 */
import { guessLanguage } from './detect';
import { normalizeLanguage } from './languages';

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface Monitor {
  addEventListener(type: 'downloadprogress', fn: (e: Event & { loaded: number; total?: number }) => void): void;
}
interface CreateOptions {
  monitor?: (m: Monitor) => void;
  signal?: AbortSignal;
}
interface Pair {
  sourceLanguage: string;
  targetLanguage: string;
}
export interface BuiltinTranslator {
  translate(text: string, o?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface BuiltinDetector {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
}
interface Apis {
  Translator?: { availability(o: Pair): Promise<Availability>; create(o: Pair & CreateOptions): Promise<BuiltinTranslator> };
  LanguageDetector?: { availability(): Promise<Availability>; create(o?: CreateOptions): Promise<BuiltinDetector> };
}
const apis = () => globalThis as unknown as Apis;

export const hasBuiltinTranslator = () => !!apis().Translator;

export async function builtinAvailability(from: string, to: string): Promise<Availability> {
  try {
    return (await apis().Translator?.availability({ sourceLanguage: from, targetLanguage: to })) ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

const translators = new Map<string, Promise<BuiltinTranslator>>();
/** the latest caller's progress callback per pair, so a retry after Cancel sees the ongoing download */
const listeners = new Map<string, (fraction: number) => void>();

/**
 * A translator for one pair, kept for the page's lifetime. The first call for a pair the browser
 * hasn't downloaded yet must come from a click (Chrome asks for a user gesture); onProgress gets
 * the language-pack download as 0–1. Aborting `signal` only stops waiting: create() gets no
 * signal, because aborting that later would destroy the cached translator (and browsers keep
 * downloading the pack anyway).
 */
export function builtinTranslator(from: string, to: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<BuiltinTranslator> {
  const key = `${from}>${to}`;
  if (onProgress) listeners.set(key, onProgress);
  let t = translators.get(key);
  if (!t) {
    const api = apis().Translator;
    if (!api) return Promise.reject(new Error('The built-in translator is not available'));
    t = api.create({
      sourceLanguage: from,
      targetLanguage: to,
      // `loaded` is a 0–1 fraction in current Chrome; early builds sent bytes with a total
      monitor: (m) => m.addEventListener('downloadprogress', (e) => listeners.get(key)?.(e.total && e.total > 1 ? e.loaded / e.total : e.loaded)),
    });
    t.catch(() => translators.delete(key)).finally(() => listeners.delete(key));
    translators.set(key, t);
  }
  if (!signal) return t;
  return Promise.race([
    t,
    new Promise<never>((_, reject) => {
      signal.throwIfAborted();
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
}

let detector: Promise<BuiltinDetector> | null = null;

/**
 * The text's language as one of our codes: the browser's detector when it has one (typing
 * counts as the user gesture its small download needs), else our own guess. Null when unsure.
 */
export async function detectLanguage(text: string): Promise<string | null> {
  const api = apis().LanguageDetector;
  try {
    if (api && !detector && (await api.availability()) !== 'unavailable') detector = api.create();
    const [top] = detector ? await (await detector).detect(text.slice(0, 3000)) : [];
    if (top && top.confidence >= 0.5) return normalizeLanguage(top.detectedLanguage);
  } catch {
    detector = null;
  }
  return guessLanguage(text);
}

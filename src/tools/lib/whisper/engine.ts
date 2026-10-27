import type { Device, ModelKey } from '@/engines/ai/models';
import { modelWorker, proxy, transfer, type ModelWorker } from '@/engines/ai/worker-utils';
import type { Word } from '../subtitle-cues';
import { toWhisperLanguage, type LanguageChoice, type WhisperLanguage } from './languages';
import { planWindows, SAMPLE_RATE, windowsDuration } from './segment';
import { placeWords } from './transcript';
import type { WhisperWorker } from './whisper.worker';

export type WhisperKey = Extract<ModelKey, 'whisper-tiny' | 'whisper-base' | 'whisper-large-turbo'>;

/** which model, in which precision, on which device: the worker (re)loads to match */
export interface WhisperSpec {
  key: WhisperKey;
  variant: string;
  device: Device;
}

export const whisperWorker = (): ModelWorker<WhisperWorker> => modelWorker<WhisperWorker>(() => new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module', name: 'whisper' }));

export interface RunOptions {
  language: LanguageChoice;
  /** translate the speech into English instead of writing it down as spoken */
  translate: boolean;
}

export interface RunEvents {
  /** seconds of speech found, before any of it is transcribed */
  onPlan?: (total: number) => void;
  onLanguage?: (code: WhisperLanguage) => void;
  /** a finished window's words, on the file's timeline; `done`/`total` are seconds of speech */
  onWords: (words: Word[], done: number, total: number) => void;
  /** the window being transcribed: its text so far, where it starts, and how far in (seconds) the model has got */
  onDraft: (text: string, start: number, at: number) => void;
}

/** detection reads up to this much speech */
const DETECT_SEC = 30;

function speechSample(audio: Float32Array, windows: { start: number; end: number }[]) {
  const parts: Float32Array[] = [];
  let n = 0;
  for (const w of windows) {
    const take = Math.min(w.end - w.start, DETECT_SEC * SAMPLE_RATE - n);
    if (take <= 0) break;
    parts.push(audio.subarray(w.start, w.start + take));
    n += take;
  }
  const out = new Float32Array(n);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Transcribes 16 kHz mono audio window by window (see segment.ts), reporting words as each
 * window finishes. Returns the language used, or null when no speech was found.
 */
export async function runWhisper(worker: ModelWorker<WhisperWorker>, spec: WhisperSpec, audio: Float32Array, o: RunOptions, ev: RunEvents, signal: AbortSignal): Promise<WhisperLanguage | null> {
  const windows = planWindows(audio);
  if (!windows.length) return null;
  const total = windowsDuration(windows);
  ev.onPlan?.(total);
  let language: WhisperLanguage;
  if (o.language === 'auto') {
    const sample = speechSample(audio, windows);
    language = toWhisperLanguage(await worker.call((api) => api.detectLanguage(spec, transfer(sample, [sample.buffer])), signal));
    ev.onLanguage?.(language);
  } else language = o.language;

  let done = 0;
  let offset = 0;
  const onText = proxy((text: string, at: number) => ev.onDraft(text, offset, at));
  for (const w of windows) {
    offset = w.start / SAMPLE_RATE;
    const piece = audio.slice(w.start, w.end);
    const chunks = await worker.call((api) => api.transcribe(spec, transfer(piece, [piece.buffer]), { language, task: o.translate ? 'translate' : 'transcribe' }, onText), signal);
    done += (w.end - w.start) / SAMPLE_RATE;
    ev.onWords(placeWords(chunks, offset, w.end / SAMPLE_RATE), done, total);
  }
  return language;
}

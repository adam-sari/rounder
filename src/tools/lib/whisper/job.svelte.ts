import { AiError, toAiError } from '@/engines/ai/errors';
import type { ModelWorker } from '@/engines/ai/worker-utils';
import { MediaError } from '@/engines/media';
import { deviceMessage, type Verdict } from '../device-guard';
import type { Word } from '../subtitle-cues';
import { decodeSpeech } from './audio';
import { runWhisper, type RunOptions, type WhisperSpec } from './engine';
import type { WhisperLanguage } from './languages';
import type { WhisperWorker } from './whisper.worker';

export type Stage = 'idle' | 'reading' | 'detecting' | 'transcribing' | 'done' | 'stopped' | 'error';

const mediaText: Record<string, string> = {
  'no-tracks': 'This file has no sound to transcribe.',
  'unsupported-input': "This browser can't read that file. An MP3, M4A, WAV, MP4 or WebM usually works.",
  'ffmpeg-failed': "The fallback decoder couldn't read this file.",
};

function friendly(err: unknown): string {
  const device = deviceMessage('transcribe', err);
  if (device) return device;
  if (err instanceof AiError) return err.message;
  if (err instanceof MediaError) return mediaText[err.code] ?? err.message;
  return toAiError(err).message;
}

/**
 * One file's trip through Whisper, shared by the transcription and subtitle tools: reading the
 * audio starts as soon as a file is chosen (while the model may still be downloading), then
 * run() transcribes it, filling `words` live.
 */
export class Transcription {
  file = $state.raw<File | null>(null);
  /** seconds */
  duration = $state(0);
  stage = $state<Stage>('idle');
  readProgress = $state(0);
  /** a file is chosen and its audio could be (or is being) read */
  readable = $state(false);
  words = $state.raw<Word[]>([]);
  /** the window in progress: its text so far, where it starts and how far in the model is */
  draft = $state<{ text: string; start: number; at: number } | null>(null);
  /** seconds of speech done / to do */
  done = $state(0);
  total = $state(0);
  language = $state<WhisperLanguage | null>(null);
  error = $state('');
  /** the low-end device check for this file: a warning to show, or null */
  deviceNote = $state.raw<Verdict | null>(null);
  /** performance.now() when the last run started and finished (0 while running) */
  startedAt = $state(0);
  finishedAt = $state(0);

  private audio: Promise<{ audio: Float32Array; duration: number }> | null = null;
  private reading: AbortController | null = null;
  private controller: AbortController | null = null;

  readonly busy = $derived(this.stage === 'reading' || this.stage === 'detecting' || this.stage === 'transcribing');
  readonly fraction = $derived(this.total ? Math.min(1, (this.done + (this.draft?.at ?? 0)) / this.total) : 0);

  /** Takes a new file and starts reading its audio */
  setFile(file: File) {
    this.reset();
    this.file = file;
    this.readable = true;
    this.reading = new AbortController();
    const read = decodeSpeech(
      file,
      { signal: this.reading.signal, onProgress: (p) => this.audio === read && (this.readProgress = p) },
      (v) => this.audio === read && (this.deviceNote = v),
    );
    this.audio = read;
    read.then(
      (r) => this.audio === read && (this.duration = r.duration),
      (err) => {
        if (this.audio !== read) return;
        this.readable = false;
        this.error = friendly(err);
        this.stage = 'error';
      },
    );
  }

  async run(worker: ModelWorker<WhisperWorker>, spec: WhisperSpec, o: RunOptions) {
    if (!this.audio || this.busy) return;
    const ctl = (this.controller = new AbortController());
    this.words = [];
    this.draft = null;
    this.done = this.total = 0;
    this.error = '';
    this.language = o.language === 'auto' ? null : o.language;
    this.startedAt = performance.now();
    this.finishedAt = 0;
    try {
      this.stage = 'reading';
      // reading may still be going; Cancel shouldn't have to wait for it
      const stopped = new Promise<never>((_, reject) => ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason), { once: true }));
      stopped.catch(() => {});
      const { audio } = await Promise.race([this.audio, stopped]);
      this.stage = o.language === 'auto' ? 'detecting' : 'transcribing';
      const language = await runWhisper(
        worker,
        spec,
        audio,
        o,
        {
          onPlan: (total) => {
            if (ctl === this.controller) this.total = total;
          },
          onLanguage: (code) => {
            this.language = code;
            this.stage = 'transcribing';
          },
          onWords: (words, done, total) => {
            if (ctl !== this.controller) return;
            this.words = [...this.words, ...words];
            this.draft = null;
            [this.done, this.total] = [done, total];
          },
          onDraft: (text, start, at) => {
            if (ctl !== this.controller) return;
            this.draft = { text, start, at };
          },
        },
        ctl.signal,
      );
      this.language = language;
      this.stage = 'done';
    } catch (err) {
      if (ctl !== this.controller) return;
      if (ctl.signal.aborted || toAiError(err).code === 'aborted') this.stage = 'stopped';
      else {
        this.error = friendly(err);
        this.stage = 'error';
      }
    } finally {
      this.draft = null;
      if (ctl === this.controller) {
        this.finishedAt = performance.now();
        this.controller = null;
      }
    }
  }

  /** stops a run at once (the worker is terminated; the next run reloads the model from the cache) */
  cancel() {
    this.controller?.abort();
  }

  reset() {
    this.controller?.abort();
    this.controller = null;
    this.reading?.abort();
    this.reading = null;
    this.audio = null;
    this.file = null;
    this.duration = this.readProgress = this.done = this.total = 0;
    this.words = [];
    this.draft = null;
    this.language = null;
    this.error = '';
    this.deviceNote = null;
    this.readable = false;
    this.stage = 'idle';
  }
}

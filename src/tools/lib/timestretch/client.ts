import { MediaError, throwIfAborted, toMediaError, type JobControl, type Pcm } from '@/engines/media/types';
import type { StretchSettings } from './stretch';
import type { StretchMessage, StretchRequest } from './worker';

export interface Stretched {
  wav: Blob;
  durationSec: number;
  /** gain applied to avoid clipping (≤ 0 dB) */
  safetyDb: number;
}

/**
 * Stretches decoded audio in a fresh worker. The channel buffers are transferred, not copied,
 * so `pcm` is unusable afterwards: pass copies to keep the originals.
 */
export function stretchInWorker(pcm: Pcm, settings: StretchSettings, ctl: JobControl = {}): Promise<Stretched> {
  throwIfAborted(ctl.signal);
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'timestretch' });
  return new Promise((resolve, reject) => {
    const stop = () => {
      worker.terminate();
      ctl.signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      stop();
      reject(new MediaError('aborted', 'Cancelled.'));
    };
    ctl.signal?.addEventListener('abort', abort);
    worker.onmessage = ({ data: m }: MessageEvent<StretchMessage>) => {
      if (m.type === 'progress') return ctl.onProgress?.(m.value);
      stop();
      if (m.type === 'done') resolve({ wav: m.wav, durationSec: m.frames / pcm.sampleRate, safetyDb: m.safetyDb });
      else reject(toMediaError(m));
    };
    worker.onerror = (e) => {
      stop();
      reject(toMediaError(new Error(e.message || 'The audio worker stopped unexpectedly.')));
    };
    const request: StretchRequest = { channels: pcm.channels, sampleRate: pcm.sampleRate, settings };
    try {
      worker.postMessage(request, [...new Set(pcm.channels.map((c) => c.buffer as ArrayBuffer))]);
    } catch {
      // some buffers can't be detached (e.g. a Web Audio decode's): send a copy instead
      try {
        worker.postMessage(request);
      } catch (e) {
        stop();
        reject(toMediaError(e));
      }
    }
  });
}

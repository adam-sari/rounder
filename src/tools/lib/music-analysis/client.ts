import * as Comlink from 'comlink';
import { decodeAudio, MediaError, probe, toMediaError, transcode, type MediaInfo, type StatusControl } from '@/engines/media';
import type { Analysis } from './analyzer';
import { needsDecoder } from './format';
import type { AnalysisWorker } from './worker';

/*
 * Browser side of the analysis: the media engine decodes 30-second mono slices in its worker
 * while ours analyzes the previous slice, so a long mix never sits in memory decoded.
 */

const CHUNK_SEC = 30;
/** share of the progress bar the ffmpeg pass takes, for files that need it */
const FALLBACK_SHARE = 0.4;

/** rejects as soon as `signal` aborts, for calls into a worker that is being terminated */
function orAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new MediaError('aborted', 'Cancelled.'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * Only the soundtrack goes through ffmpeg, as mono 22.05 kHz WAV: no video to remux or re-encode,
 * and even a 2-hour file stays around 320 MB.
 */
async function audioViaFallback(file: Blob, ctl: StatusControl): Promise<{ src: Blob; duration: number }> {
  const { signal, onStatus } = ctl;
  const info = await probe(file, { fallback: true, signal, onStatus });
  if (!info.audio) throw new MediaError('no-tracks', 'This file has no audio track to analyze.');
  onStatus?.('Converting with the extra decoder…');
  const wav = await transcode(
    file,
    { container: 'wav', audio: { channels: 1, sampleRate: 22050 }, keepMetadata: false },
    { engine: 'ffmpeg', signal, onStatus, onProgress: (p) => ctl.onProgress?.(p * FALLBACK_SHARE) },
  );
  return { src: wav.blob, duration: (await probe(wav.blob, { signal })).durationSec };
}

/**
 * Tempo, beats, key and waveform of a file's audio. Files the browser can't decode go through the
 * ffmpeg fallback (ask the user first: `needsDecoder(info)`).
 */
export async function analyzeFile(file: Blob, info: MediaInfo, ctl: StatusControl = {}): Promise<Analysis> {
  const { signal } = ctl;
  let src = file;
  let duration = info.durationSec;
  let base = 0;
  if (needsDecoder(info)) {
    ({ src, duration } = await audioViaFallback(file, ctl));
    base = FALLBACK_SHARE;
  }

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'music-analysis' });
  const api = Comlink.wrap<AnalysisWorker>(worker);
  signal?.addEventListener('abort', () => worker.terminate(), { once: true });
  try {
    await orAbort(api.start(duration), signal);
    ctl.onStatus?.('Listening…');
    const chunks = duration > 0 && Number.isFinite(duration) ? Math.ceil(duration / CHUNK_SEC) : 1;
    const report = (done: number) => ctl.onProgress?.(base + (1 - base) * 0.95 * Math.min(1, done / chunks));
    let pending: Promise<void> = Promise.resolve();
    for (let i = 0; i < chunks; i++) {
      // the last slice runs to the real end, whatever the container claimed
      const range = chunks === 1 ? {} : { start: i * CHUNK_SEC, end: i === chunks - 1 ? undefined : (i + 1) * CHUNK_SEC };
      const pcm = await decodeAudio(src, { ...range, mono: true }, { signal, onProgress: (p) => report(i + Math.min(1, Math.max(0, p))) });
      await orAbort(pending, signal);
      const mono = pcm.channels[0];
      if (mono?.length) pending = api.push(Comlink.transfer(mono, [mono.buffer]), pcm.sampleRate);
      report(i + 1);
    }
    await orAbort(pending, signal);
    ctl.onStatus?.('Finding the beat and key…');
    const result = await orAbort(api.finish(), signal);
    ctl.onProgress?.(1);
    return result;
  } catch (e) {
    throw signal?.aborted ? new MediaError('aborted', 'Cancelled.') : toMediaError(e);
  } finally {
    worker.terminate();
  }
}

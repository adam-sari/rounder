import * as Comlink from 'comlink';
import { decodeAudio, downloadName, encodeAudio, MediaError, throwIfAborted, toMediaError, transcode, writeWav, type MediaInfo, type Pcm } from '@/engines/media';
import type { Loudness } from './lufs';
import { videoContainer, wavCodec, type OutputFormat } from './presets';
import type { DspApi, ProcessOptions } from './worker';

/*
 * The browser side of both loudness tools: decode with the media engine, measure or
 * gain/limit in our DSP worker, then encode, or put the new audio back into the video.
 */

export interface JobCtl {
  signal?: AbortSignal;
  onProgress?: (p: number) => void;
  onStatus?: (s: string) => void;
}

let current: { worker: Worker; api: Comlink.Remote<DspApi> } | null = null;

/** runs a call in the DSP worker; a tight DSP loop can't be interrupted, so cancelling kills the worker */
function inWorker<T>(signal: AbortSignal | undefined, fn: (api: Comlink.Remote<DspApi>) => Promise<T>): Promise<T> {
  throwIfAborted(signal);
  if (!current) {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'loudness' });
    current = { worker, api: Comlink.wrap<DspApi>(worker) };
  }
  const self = current;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      self.worker.terminate();
      if (current === self) current = null;
      reject(new MediaError('aborted', 'Cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    fn(self.api)
      .then(resolve, (e) => reject(toMediaError(e)))
      .finally(() => signal?.removeEventListener('abort', abort));
  });
}

/** hands the channel buffers to the worker instead of copying them; `pcm` is unusable afterwards (channels may share a buffer, and a transfer list can't repeat one) */
const send = (pcm: Pcm) => Comlink.transfer(pcm, [...new Set(pcm.channels.map((c) => c.buffer as ArrayBuffer))]);
const span = (ctl: JobCtl, from: number, to: number) => (p: number) => ctl.onProgress?.(from + (to - from) * p);

function decode(file: Blob, ctl: JobCtl, to: number) {
  ctl.onStatus?.('Decoding audio…');
  return decodeAudio(file, {}, { signal: ctl.signal, onStatus: ctl.onStatus, onProgress: span(ctl, 0, to) });
}

/** integrated loudness, range and peaks of a file's (first) audio track */
export async function analyze(file: Blob, ctl: JobCtl = {}): Promise<Loudness> {
  const pcm = await decode(file, ctl, 0.75);
  ctl.onStatus?.('Measuring loudness…');
  return inWorker(ctl.signal, (api) => api.measure(send(pcm), Comlink.proxy(span(ctl, 0.75, 1))));
}

export interface RenderOptions extends Omit<ProcessOptions, 'measure'> {
  format: OutputFormat;
  /** added to the file name, e.g. "-louder" */
  suffix: string;
  /** measure the processed audio for an after report */
  measureAfter?: boolean;
}

export interface Rendered {
  blob: Blob;
  name: string;
  /** deepest limiter gain reduction in dB */
  reductionDb: number;
  after?: Loudness;
}

/**
 * Applies gain (and the limiter) to `source`'s audio and writes `format`. For 'video' the picture
 * is copied untouched and only the soundtrack is re-encoded. `name` is the original file name.
 */
export async function render(source: Blob, name: string, info: MediaInfo, o: RenderOptions, ctl: JobCtl = {}): Promise<Rendered> {
  const pcm = await decode(source, ctl, 0.3);
  ctl.onStatus?.(o.limit ? 'Adjusting volume and taming peaks…' : 'Adjusting volume…');
  const { format, suffix, measureAfter, ...dsp } = o;
  const done = await inWorker(ctl.signal, (api) => api.process(send(pcm), { ...dsp, measure: !!measureAfter }, Comlink.proxy(span(ctl, 0.3, 0.5))));
  const result = { reductionDb: done.reductionDb, after: done.after };

  if (format !== 'video') {
    ctl.onStatus?.('Encoding…');
    const codec = format === 'wav' ? wavCodec(info.audio?.codec) : undefined;
    const blob = await encodeAudio(done.pcm, { format, codec }, { signal: ctl.signal, onProgress: span(ctl, 0.5, 1) });
    return { ...result, blob, name: downloadName(name, format, suffix) };
  }

  ctl.onStatus?.('Putting the new audio into the video…');
  const container = videoContainer(info.container);
  const wav = new Blob([writeWav(done.pcm, 'pcm-s16')], { type: 'audio/wav' });
  const out = await transcode(
    source,
    { container, audio: { replace: wav, codec: container === 'webm' ? 'opus' : 'aac' } },
    { signal: ctl.signal, onProgress: span(ctl, 0.5, 1) },
  );
  return { ...result, blob: out.blob, name: downloadName(name, container, suffix) };
}

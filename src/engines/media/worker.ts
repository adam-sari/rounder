/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import * as core from './core';
import { MediaError, type Frame, type JobControl, type Pcm, type TranscodeOptions } from './types';

/*
 * The media worker: hosts core.ts so demuxing, canvas work and encoder plumbing stay off
 * the main thread. AbortSignals can't be posted, so the client aborts by job id.
 */

// keep MediaError.code when errors cross back to the page (comlink only copies name/message/stack)
const throwHandler = Comlink.transferHandlers.get('throw')!;
Comlink.transferHandlers.set('throw', {
  canHandle: throwHandler.canHandle,
  serialize(thrown: unknown) {
    const [wire, transfer] = throwHandler.serialize(thrown);
    const value = (thrown as { value: unknown }).value;
    if (value instanceof MediaError) (wire as { value: Record<string, unknown> }).value.code = value.code;
    return [wire, transfer];
  },
  deserialize: throwHandler.deserialize,
});

const jobs = new Map<number, AbortController>();

type Progress = ((p: number) => void) | undefined;

async function job<T>(id: number, onProgress: Progress, fn: (ctl: JobControl) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  jobs.set(id, controller);
  try {
    return await fn({ signal: controller.signal, onProgress: onProgress && throttle(onProgress) });
  } finally {
    jobs.delete(id);
  }
}

/** progress callbacks cost a postMessage each; ~20 a second is plenty for a progress bar */
function throttle(fn: (p: number) => void) {
  let last = 0;
  return (p: number) => {
    const now = performance.now();
    if (p >= 1 || now - last > 50) {
      last = now;
      fn(p);
    }
  };
}

const transferFrames = (frames: Frame[]) => Comlink.transfer(frames, frames.map((f) => f.bitmap));

const api = {
  abort(id: number) {
    jobs.get(id)?.abort();
  },
  probe: core.probe,
  capabilities: core.capabilities,
  transcode: (id: number, file: Blob, o: TranscodeOptions, onProgress?: Progress) => job(id, onProgress, (ctl) => core.transcode(file, o, ctl)),
  async extractFrames(id: number, file: Blob, req: core.FramesRequest, onProgress?: Progress, onFrame?: (f: Frame, i: number) => void) {
    const frames = await job(id, onProgress, (ctl) =>
      core.extractFrames(file, req, { ...ctl, onFrame: onFrame && ((f, i) => onFrame(Comlink.transfer(f, [f.bitmap]), i)) }),
    );
    return transferFrames(frames);
  },
  async decodeAudio(id: number, file: Blob, o: core.DecodeAudioOptions, onProgress?: Progress) {
    const pcm = await job(id, onProgress, (ctl) => core.decodeAudio(file, o, ctl));
    return Comlink.transfer(pcm, [...new Set(pcm.channels.map((c) => c.buffer as ArrayBuffer))]);
  },
  waveform: (id: number, file: Blob, buckets: number, o: { start?: number; end?: number }, onProgress?: Progress) =>
    job(id, onProgress, (ctl) => core.waveform(file, buckets, o, ctl)),
  encodeAudio: (id: number, pcm: Pcm, o: core.EncodeAudioOptions, onProgress?: Progress) => job(id, onProgress, (ctl) => core.encodeAudio(pcm, o, ctl)),
  concat: (id: number, files: Blob[], o: core.ConcatOptions, onProgress?: Progress) => job(id, onProgress, (ctl) => core.concat(files, o, ctl)),
  imagesToVideo: (id: number, images: (Blob | ImageBitmap)[], o: core.SlideshowOptions, onProgress?: Progress) =>
    job(id, onProgress, (ctl) => core.imagesToVideo(images, o, ctl)),
  videoToGif: (id: number, file: Blob, o: core.GifOptions, onProgress?: Progress) => job(id, onProgress, (ctl) => core.videoToGif(file, o, ctl)),
  gifToVideo: (id: number, file: Blob, o: core.GifToVideoOptions, onProgress?: Progress) => job(id, onProgress, (ctl) => core.gifToVideo(file, o, ctl)),
  async decodeGif(id: number, file: Blob) {
    const gif = await job(id, undefined, (ctl) => core.decodeGif(file, ctl));
    return Comlink.transfer(gif, gif.frames.map((f) => f.bitmap));
  },
};

export type MediaWorker = typeof api;

Comlink.expose(api);

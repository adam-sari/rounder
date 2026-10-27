/**
 * Rounder media engine — video & audio, entirely in the browser.
 *
 * Primary path: mediabunny + WebCodecs in a Web Worker (hardware codecs, streaming reads, no
 * file-size cap on input; outputs over ~256 MB stream to OPFS instead of RAM). Fallback:
 * ffmpeg.wasm (single-thread, ~31 MB, fetched on first need) for containers/codecs the browser
 * can't decode (AVI, WMV, FLV, MPEG-2, AC-3 …) and for browsers without WebCodecs.
 * Every async call takes `{ onProgress?(0–1), signal? }` and throws `MediaError` with a stable
 * `code`: unsupported-input | unsupported-codec | no-webcodecs | no-tracks | invalid-options |
 * aborted | out-of-memory | ffmpeg-failed | failed. `message` is written for end users.
 *
 * ── Inspect ──────────────────────────────────────────────────────────────────────────────
 *   const info = await probe(file);            // container, durationSec, video{codec,width,height,displayWidth,…,fps,bitrate,canDecode}, audio{…}
 *   if (info.needsFallback) showNote(`Needs a one-time ${FALLBACK_DOWNLOAD_MB} MB decoder`);
 *   const caps = await capabilities();         // caps.video.encode → ['avc','vp9',…], caps.containers.webm → true
 *
 * ── Convert / compress / trim / crop / rotate / speed / mute ─────────────────────────────
 *   const ctrl = new AbortController();
 *   const out = await transcode(file, {
 *     container: 'mp4',                       // mp4 | mov | webm | mkv | mp3 | wav | ogg | m4a | flac
 *     trim: { start: 2, end: 9.5 },
 *     video: { codec: 'avc', width: 1280, targetSizeBytes: 8e6, fps: 30 },   // or quality: 'medium' | bitrate
 *     audio: { bitrate: 128_000 },            // false = mute; { replace: musicFile } = swap the soundtrack
 *   }, { onProgress: (p) => (bar = p), onStatus: (s) => (status = s), signal: ctrl.signal });
 *   downloadBlob(out.blob, downloadName(file.name, out.container)); // from @/tools/lib/files; out.notes lists fallbacks taken
 *
 *   9:16 for Reels:  video: { width: 1080, height: 1920, fit: 'cover' }   (or crop: {x,y,width,height} first)
 *   Rotate / flip:   video: { rotate: 90, flipHorizontal: true }          (baked into pixels)
 *   Order is rotate → flip → crop → resize, so `crop` is in the rotated frame's display pixels
 *   (a 1920×1080 clip with rotate: 90 is cropped as 1080×1920).
 *   Speed 2×:        video: { speed: 2 }                                   (audio pitch follows; drop it with audio: false)
 *   Video → MP3:     transcode(file, { container: 'mp3', audio: { bitrate: 192_000 } })
 *   Volume +6 dB:    audio: { gainDb: 6 }
 *   Without re-encoding: omit codec/quality/size options and mediabunny copies the streams (fast, lossless).
 *   Audio bitrates are rounded to what the encoder takes (AAC: 96/128/160/192k, MP3 ladder);
 *   use snapAudioBitrate(codec, bps) to show the real value in the UI.
 *   FLAC output has no WebCodecs encoder in any browser yet, so it goes through ffmpeg.wasm.
 *
 * ── Per-frame hooks (watermarks, subtitles, AI background removal, auto-reframe) ─────────
 *   video: { overlay: (ctx, f) => { ctx.font = '48px Geist'; ctx.fillText(caption(f.time), 40, f.height - 60); } }
 *   video: { width: 1080, height: 1920, render: (ctx, src, f) => src.drawWithFit(ctx, { fit: 'cover', crop: boxAt(f.time) }) }
 *   Hooks run on the main thread (functions can't enter a worker); everything else runs in the worker.
 *
 * ── Frames ───────────────────────────────────────────────────────────────────────────────
 *   const thumbs = await extractFrames(file, { count: 12, height: 72 }, { onFrame: (f) => strip.push(f) });
 *   const still = await frameAt(file, 3.2);                    // ImageBitmap at display size
 *   const png = await bitmapToBlob(still, 'image/png');
 *
 * ── Audio ────────────────────────────────────────────────────────────────────────────────
 *   const pcm = await decodeAudio(file, { start: 10, end: 40 });  // { sampleRate, channels: Float32Array[] }
 *   const peaks = await waveform(file, 800);                     // streamed; { min, max, rms } per bucket
 *   const mp3 = await encodeAudio(pcm, { format: 'mp3', bitrate: 192_000 });  // wav | mp3 | m4a | ogg | flac | webm
 *   Pure helpers (also usable in your own workers): computePeaks, writeWav, parseWav, mixdown, resample,
 *   applyGain, peakLevel, dbToGain, fade, Resampler, PeakAccumulator.
 *
 * ── Joining, slideshows, GIF ─────────────────────────────────────────────────────────────
 *   await concat([a, b, c], { container: 'mp4' });              // re-encodes; mismatched sizes letterboxed
 *   await concat([a, b], { container: 'mp3' });                 // audio joiner
 *   await imagesToVideo(photos, { width: 1080, height: 1920, durations: 3, transition: 'fade', kenBurns: true, audio: song });
 *   await videoToGif(file, { fps: 12, width: 480, start: 1, end: 4 });
 *   await gifToVideo(gif, { container: 'mp4', repeat: 3 });
 *   const { frames } = await decodeGif(gif);                     // [{ bitmap, delayMs }]
 *
 * ── Odd formats ──────────────────────────────────────────────────────────────────────────
 *   transcode/extractFrames/decodeAudio/waveform/videoToGif/concat fall back to ffmpeg.wasm on their own.
 *   To convert once up front (e.g. a trimmer previewing an AVI in <video>):
 *     const { file: playable } = await ensureDecodable(file, { onStatus });
 *
 * ── Time & math helpers ──────────────────────────────────────────────────────────────────
 *   formatTime(75.5) → "01:15.50", parseTime("1:15.5") → 75.5, planVideoSize, bitrateForTargetSize,
 *   estimateSizeBytes, suggestedBitrate, snapAudioBitrate, normalizeSegments, invertSegments,
 *   segmentsDuration, outputToSourceTime, formatBytes, formatBitrate.
 *   UI: src/components/tool/TrimTimeline.svelte (trim handles / multi-segment), Waveform.svelte.
 *   Multi-segment export (cutter, "remove the middle"): transcode each kept segment with
 *   `trim`, then concat() the results — or for audio, decodeAudio once, slice and encodeAudio.
 *
 * ── Testing ──────────────────────────────────────────────────────────────────────────────
 *   /dev/media-lab exercises every call. From any dev-server page's console:
 *     console.table(await (await import('/src/engines/media/lab/smoke.ts')).runSmoke())
 *
 * Browser notes: Chrome/Edge have every codec (HEVC encode only with hardware support; on
 * Windows AAC is Media Foundation's, hence the bitrate rounding). Safari 26 encodes H.264/HEVC/
 * VP9 and AAC natively. Firefox has no native AAC encoder (a wasm one loads automatically) and
 * decodes HEVC only on some platforms. MP3 encoding always uses LAME (wasm, ~300 KB on first use).
 * The ffmpeg.wasm fallback writes H.264 (MP4/MOV/MKV) or VP8 (WebM) — its VP9/libopus/x265 are
 * unusable in this single-thread build — and is far slower than WebCodecs (one thread, no GPU).
 */
import * as Comlink from 'comlink';
import type * as Core from './core';
import { parseWav, computePeaks, mixdown, resample, writeWav } from './dsp';
import {
  containers,
  isAudioContainer,
  MediaError,
  throwIfAborted,
  toMediaError,
  type Capabilities,
  type Container,
  type Frame,
  type JobControl,
  type MediaInfo,
  type Pcm,
  type Peaks,
  type TranscodeControl,
  type TranscodeOptions,
  type TranscodeResult,
} from './types';
import type { MediaWorker } from './worker';

export * from './types';
export * from './math';
export { applyGain, computePeaks, dbToGain, fade, gainToDb, mixdown, parseWav, PeakAccumulator, peakLevel, pcmDuration, Resampler, resample, writeWav } from './dsp';
export type { ConcatOptions, DecodeAudioOptions, EncodeAudioOptions, FramesRequest, GifOptions, GifToVideoOptions, SlideshowOptions, DecodedGif } from './core';

/** size of the one-time ffmpeg.wasm download, for "needs a decoder" notices */
export const FALLBACK_DOWNLOAD_MB = 31;

export interface StatusControl extends JobControl {
  /** human-readable stage, e.g. "Downloading decoder… 40%" */
  onStatus?: (status: string) => void;
}

let worker: Comlink.Remote<MediaWorker> | null = null;
let jobIds = 0;

function remote() {
  worker ??= Comlink.wrap<MediaWorker>(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'media' }));
  return worker;
}

type Progress = ((p: number) => void) | undefined;

/** runs a worker call with abort wiring and error normalisation */
async function call<T>(ctl: JobControl | undefined, fn: (api: Comlink.Remote<MediaWorker>, id: number, onProgress: Progress) => Promise<T>): Promise<T> {
  throwIfAborted(ctl?.signal);
  const api = remote();
  const id = ++jobIds;
  const abort = () => void api.abort(id);
  ctl?.signal?.addEventListener('abort', abort);
  try {
    return await fn(api, id, ctl?.onProgress ? Comlink.proxy(ctl.onProgress) : undefined);
  } catch (e) {
    throw ctl?.signal?.aborted ? new MediaError('aborted', 'Cancelled.') : toMediaError(e);
  } finally {
    ctl?.signal?.removeEventListener('abort', abort);
  }
}

const loadFallback = () => import('./ffmpeg');
const loadCore = () => import('./core');

/** maps a sub-stage's 0–1 progress into [from, to] of the caller's bar */
const span = (ctl: JobControl | undefined, from: number, to: number): Progress => (ctl?.onProgress ? (p) => ctl.onProgress!(from + (to - from) * p) : undefined);

function fallbackCtl(ctl: StatusControl | undefined, from: number, to: number, label = 'Converting with the fallback decoder…') {
  let announced = false;
  return {
    signal: ctl?.signal,
    onProgress: (p: number) => {
      if (!announced) ctl?.onStatus?.(label);
      announced = true;
      span(ctl, from, to)?.(p);
    },
    download: (p: number) => ctl?.onStatus?.(`Downloading decoder… ${Math.round(p * 100)}%`),
  };
}

export const hasWebCodecs = () => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';

/**
 * Reads container, duration and track details. Files the browser can't open come back with
 * `readable: false, needsFallback: true`; pass `{ fallback: true }` to have ffmpeg.wasm fill in
 * the details (downloads the decoder).
 */
export async function probe(file: Blob, o: StatusControl & { fallback?: boolean } = {}): Promise<MediaInfo> {
  const info = await call(o, (api) => api.probe(file));
  if (info.readable || info.container === 'gif' || !o.fallback) return info;
  const ff = await loadFallback();
  const details = await ff.ffmpegProbe(file, fallbackCtl(o, 0, 1, 'Reading file…'));
  if (!details) throw new MediaError('unsupported-input', "This file isn't a video or audio format we can read.");
  return details;
}

let caps: Promise<Capabilities> | null = null;
/**
 * Which codecs/containers this browser can encode and decode (cached). `containers` says what
 * transcode() can write: FLAC is always true because it falls back to ffmpeg.wasm's encoder.
 */
export function capabilities(): Promise<Capabilities> {
  caps ??= call(undefined, (api) => api.capabilities()).then((c) => ({ ...c, containers: { ...c.containers, flac: true } })).catch((e) => {
    caps = null;
    throw e;
  });
  return caps;
}

const noVideoDecoder = () => new MediaError('no-webcodecs', "This browser can't decode video frames (it has no WebCodecs). Try a recent Chrome, Edge, Safari or Firefox.");

const decodableCache = new WeakMap<Blob, Promise<{ file: Blob; info: MediaInfo; converted: boolean }>>();

/**
 * Returns a version of `file` that WebCodecs can decode: the file itself when it already is,
 * otherwise a Matroska copy made by ffmpeg.wasm (streams copied when possible). Cached per file.
 */
export function ensureDecodable(file: Blob, ctl: StatusControl = {}): Promise<{ file: Blob; info: MediaInfo; converted: boolean }> {
  let job = decodableCache.get(file);
  if (!job) {
    job = (async () => {
      const info = await probe(file, { signal: ctl.signal });
      if (!info.needsFallback) return { file, info, converted: false };
      // the fallback's copy is decoded with WebCodecs too, so without a VideoDecoder the download can't help
      if (info.video && typeof VideoDecoder === 'undefined') throw noVideoDecoder();
      const n = await normalize(file, info, {}, ctl, 0, 1);
      return { file: n.blob, info: n.info, converted: true };
    })();
    decodableCache.set(file, job);
    job.catch(() => decodableCache.delete(file));
  }
  return job;
}

/** ffmpeg pass: copy video if the browser can decode it, else x264; check the result decodes */
async function normalize(file: Blob, info: MediaInfo, trim: { start?: number; end?: number }, ctl: StatusControl, from: number, to: number) {
  const ff = await loadFallback();
  const details = info.readable ? info : await ff.ffmpegProbe(file, fallbackCtl(ctl, from, from, 'Reading file…'));
  if (!details) throw new MediaError('unsupported-input', "This file isn't a video or audio format we can read.");
  const mid = from + (to - from) * 0.5;
  const reencode = !!(info.readable && info.video && !info.video.canDecode);
  let n = await ff.ffmpegNormalize(file, details, { ...trim, reencodeVideo: reencode }, fallbackCtl(ctl, from, reencode ? to : mid));
  let check = await call(undefined, (api) => api.probe(n.blob));
  if (!reencode && check.video && !check.video.canDecode) {
    n = await ff.ffmpegNormalize(file, details, { ...trim, reencodeVideo: true }, fallbackCtl(ctl, mid, to));
    check = await call(undefined, (api) => api.probe(n.blob));
  }
  if (check.needsFallback) {
    throw check.video && typeof VideoDecoder === 'undefined' ? noVideoDecoder() : new MediaError('unsupported-input', "This file's codecs can't be converted in the browser.");
  }
  return { blob: n.blob, offset: n.offset, info: check };
}

const shiftTrim = (o: TranscodeOptions, offset: number): TranscodeOptions =>
  offset && o.trim ? { ...o, trim: { start: Math.max(0, (o.trim.start ?? offset) - offset), end: o.trim.end === undefined ? undefined : o.trim.end - offset } } : o;

/** The workhorse: convert, compress, trim, crop, resize, rotate, flip, re-time, mute or re-voice. */
export async function transcode(file: Blob, o: TranscodeOptions, ctl: TranscodeControl & StatusControl = {}): Promise<TranscodeResult> {
  if (!containers[o.container]) throw new MediaError('invalid-options', `Unknown output format "${o.container}".`);
  const hooks = !!(o.video && (o.video.overlay || o.video.render));
  const wantsVideo = !isAudioContainer(o.container) && o.video !== false;

  // no browser ships a FLAC encoder for WebCodecs yet; ffmpeg's is fast and lossless
  const flacViaFfmpeg = o.container === 'flac' && !(await capabilities().catch(() => null))?.audio.encode.includes('flac');
  if (ctl.engine === 'ffmpeg' || flacViaFfmpeg || (wantsVideo && !hasWebCodecs())) {
    if (hooks) throw new MediaError('no-webcodecs', 'This browser is missing WebCodecs, which this tool needs. Try a recent Chrome, Edge, Safari or Firefox.');
    const ff = await loadFallback();
    let info = await call({ signal: ctl.signal }, (api) => api.probe(file)).catch(() => null);
    if (!info?.readable) info = await ff.ffmpegProbe(file, fallbackCtl(ctl, 0, 0, 'Reading file…'));
    if (!info) throw new MediaError('unsupported-input', "This file isn't a video or audio format we can read.");
    return ff.ffmpegTranscode(file, o, info, fallbackCtl(ctl, 0, 1, 'Converting…'));
  }

  const run = (src: Blob, opts: TranscodeOptions, from: number) => {
    ctl.onStatus?.('Converting…');
    if (hooks) {
      return loadCore().then((core) => core.transcode(src, opts, { signal: ctl.signal, onProgress: span(ctl, from, 1) })).catch((e) => {
        throw ctl.signal?.aborted ? new MediaError('aborted', 'Cancelled.') : toMediaError(e);
      });
    }
    return call({ signal: ctl.signal, onProgress: span(ctl, from, 1) }, (api, id, p) => api.transcode(id, src, opts, p));
  };

  const viaFallback = async (info: MediaInfo) => {
    const cached = decodableCache.get(file);
    let src: Blob;
    let offset = 0;
    // trimmed jobs only convert the part they need, unless the whole file was converted already
    if (cached) src = (await cached).file;
    else ({ blob: src, offset } = await normalize(file, info, o.trim ?? {}, ctl, 0, 0.5));
    const result = await run(src, shiftTrim(o, offset), 0.5);
    return { ...result, notes: [...result.notes, 'Decoded with the ffmpeg fallback.'] };
  };

  const info = await probe(file, { signal: ctl.signal });
  const needsVideo = wantsVideo && info.video;
  const needsAudio = o.audio !== false && info.audio && !(o.audio && o.audio.replace);
  if (!info.readable || (needsVideo && !info.video!.canDecode) || (needsAudio && !info.audio!.canDecode)) return viaFallback(info);
  try {
    return await run(file, o, 0);
  } catch (e) {
    // a decoder can still refuse mid-way (odd profiles); one retry through ffmpeg
    if (e instanceof MediaError && e.code === 'unsupported-input') return viaFallback(info);
    throw e;
  }
}

/** Thumbnails or stills. With `onFrame`, frames stream in as they decode (and are also returned). */
export async function extractFrames(file: Blob, req: Core.FramesRequest, ctl: StatusControl & { onFrame?: (f: Frame, i: number) => void } = {}): Promise<Frame[]> {
  const once = (src: Blob) => {
    const got: Frame[] = [];
    const onFrame = (f: Frame, i: number) => {
      got.push(f);
      ctl.onFrame?.(f, i);
    };
    return call(ctl, (api, id, p) => api.extractFrames(id, src, req, p, Comlink.proxy(onFrame))).then(() => got);
  };
  try {
    return await once(file);
  } catch (e) {
    if (!(e instanceof MediaError && e.code === 'unsupported-input')) throw e;
    return once((await ensureDecodable(file, ctl)).file);
  }
}

/** one frame at `time` seconds; size defaults to the display size */
export async function frameAt(file: Blob, time: number, size: { width?: number; height?: number } = {}, ctl: StatusControl = {}): Promise<ImageBitmap> {
  const [frame] = await extractFrames(file, { times: [time], ...size }, ctl);
  if (!frame) throw new MediaError('failed', 'No frame at that time.');
  return frame.bitmap;
}

export async function bitmapToBlob(bitmap: ImageBitmap, type = 'image/png', quality = 0.92): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type, quality });
}

function shape(pcm: Pcm, o: Core.DecodeAudioOptions): Pcm {
  let out = pcm;
  if (o.start || o.end) {
    const a = Math.round((o.start ?? 0) * pcm.sampleRate);
    const b = o.end ? Math.round(o.end * pcm.sampleRate) : undefined;
    out = { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice(a, b)) };
  }
  if (o.mono) out = { sampleRate: out.sampleRate, channels: [mixdown(out.channels)] };
  return o.sampleRate ? resample(out, o.sampleRate) : out;
}

/** Decodes the primary audio track to PCM. Falls back to Web Audio, then ffmpeg.wasm. */
export async function decodeAudio(file: Blob, o: Core.DecodeAudioOptions = {}, ctl: StatusControl = {}): Promise<Pcm> {
  try {
    return await call(ctl, (api, id, p) => api.decodeAudio(id, file, o, p));
  } catch (e) {
    if (!(e instanceof MediaError && e.code === 'unsupported-input')) throw e;
  }
  try {
    // Web Audio knows a few formats WebCodecs doesn't (e.g. some ADPCM WAVs); resamples to 48 kHz
    const ctx = new OfflineAudioContext(1, 1, o.sampleRate ?? 48000);
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const pcm = { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)) };
    return shape(pcm, { ...o, sampleRate: undefined });
  } catch {
    throwIfAborted(ctl.signal);
  }
  const ff = await loadFallback();
  const wav = await ff.ffmpegToWav(file, { start: o.start, end: o.end }, fallbackCtl(ctl, 0, 1, 'Decoding with the fallback decoder…'));
  return shape(parseWav(wav), { ...o, start: undefined, end: undefined });
}

/** Streams min/max/rms peaks for a waveform without keeping the decoded audio */
export async function waveform(file: Blob, buckets: number, o: { start?: number; end?: number } = {}, ctl: StatusControl = {}): Promise<Peaks> {
  try {
    return await call(ctl, (api, id, p) => api.waveform(id, file, buckets, o, p));
  } catch (e) {
    if (!(e instanceof MediaError && e.code === 'unsupported-input')) throw e;
    return computePeaks(await decodeAudio(file, o, ctl), buckets);
  }
}

/** PCM → wav | mp3 | m4a | ogg | flac | webm */
export async function encodeAudio(pcm: Pcm, o: Core.EncodeAudioOptions, ctl: JobControl = {}): Promise<Blob> {
  if (o.format === 'wav') return (await loadCore()).encodeAudio(pcm, o, ctl);
  if (o.format === 'flac' && !(await capabilities()).audio.encode.includes('flac')) {
    // WAV in, FLAC out through ffmpeg.wasm (see transcode)
    const wav = new Blob([writeWav(pcm, 'pcm-s24')], { type: 'audio/wav' });
    return (await transcode(wav, { container: 'flac' }, ctl)).blob;
  }
  return call(ctl, (api, id, p) => api.encodeAudio(id, pcm, o, p));
}

/** Joins clips end to end. Unreadable inputs are converted with ffmpeg.wasm first. */
export async function concat(files: Blob[], o: Core.ConcatOptions, ctl: StatusControl = {}): Promise<TranscodeResult> {
  const sources: Blob[] = [];
  for (const f of files) sources.push((await ensureDecodable(f, ctl)).file);
  return call(ctl, (api, id, p) => api.concat(id, sources, o, p));
}

/** ImageBitmaps are copied into the worker, not transferred, so the caller's previews stay usable */
export function imagesToVideo(images: (Blob | ImageBitmap)[], o: Core.SlideshowOptions = {}, ctl: JobControl = {}): Promise<TranscodeResult> {
  return call(ctl, (api, id, p) => api.imagesToVideo(id, images, o, p));
}

export async function videoToGif(file: Blob, o: Core.GifOptions = {}, ctl: StatusControl = {}): Promise<Blob> {
  const src = (await ensureDecodable(file, ctl)).file;
  return call(ctl, (api, id, p) => api.videoToGif(id, src, o, p));
}

export function gifToVideo(file: Blob, o: Core.GifToVideoOptions = {}, ctl: JobControl = {}): Promise<TranscodeResult> {
  return call(ctl, (api, id, p) => api.gifToVideo(id, file, o, p));
}

export function decodeGif(file: Blob, ctl: JobControl = {}): Promise<Core.DecodedGif> {
  return call(ctl, (api, id) => api.decodeGif(id, file));
}

/** Fetches and boots the ffmpeg.wasm fallback ahead of time (e.g. when probe says needsFallback). */
export async function preloadFallback(onProgress?: (p: number) => void): Promise<void> {
  await (await loadFallback()).loadFfmpeg(onProgress);
}

/** "holiday.MOV" + mp4 → "holiday.mp4"; adds a suffix when the name wouldn't change */
export function downloadName(original: string, container: Container | 'gif' | 'png' | 'jpg', suffix = ''): string {
  const base = original.replace(/\.[^.]+$/, '') || 'media';
  const ext = container in containers ? containers[container as Container].ext : container;
  const same = original.toLowerCase().endsWith(`.${ext}`) && !suffix;
  return `${base}${same ? '-rounder' : suffix}.${ext}`;
}

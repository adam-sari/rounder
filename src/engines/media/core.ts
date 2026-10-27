import {
  ADTS,
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Conversion,
  FLAC,
  FlacOutputFormat,
  getEncodableAudioCodecs,
  getEncodableVideoCodecs,
  getDecodableAudioCodecs,
  getDecodableVideoCodecs,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  MATROSKA,
  MkvOutputFormat,
  MovOutputFormat,
  MP3,
  Mp3OutputFormat,
  MP4,
  Mp4OutputFormat,
  MPEG_TS,
  OGG,
  OggOutputFormat,
  Output,
  QTFF,
  Quality,
  StreamTarget,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  WAVE,
  WavOutputFormat,
  WEBM,
  WebMOutputFormat,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type InputAudioTrack,
  type InputTrack,
  type InputVideoTrack,
  type OutputFormat,
  type StreamTargetChunk,
  type Target,
} from 'mediabunny';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { dbToGain, encoderSampleRate, mixdown, PeakAccumulator, Resampler, resample, writeWav } from './dsp';
import { decodeGifFrames, isGif, parseGif } from './gif';
import { bitrateForTargetSize, clamp, evenize, planVideoSize, snapAudioBitrate, spreadTimes } from './math';
import {
  containers,
  isAudioContainer,
  MediaError,
  throwIfAborted,
  toMediaError,
  type AudioCodec,
  type Capabilities,
  type Container,
  type Ctx2D,
  type Frame,
  type JobControl,
  type MediaInfo,
  type Pcm,
  type Peaks,
  type QualityLevel,
  type TranscodeOptions,
  type TranscodeResult,
  type VideoCodec,
  type VideoOptions,
} from './types';

/*
 * Everything that touches mediabunny. Runs in the media worker by default, and on the main
 * thread when a job carries per-frame hooks (functions can't cross into a worker).
 */

// ---------------------------------------------------------------- inputs

interface CachedInput {
  input: Input;
  users: number;
  stale: boolean;
}

const inputs = new Map<string, CachedInput>();
const MAX_INPUTS = 4;

/** Files are re-sent to the worker for every call, so identity is name + size + mtime */
function inputKey(file: Blob): string | null {
  const f = file as Partial<File>;
  return f.name && f.lastModified ? `${f.name}|${file.size}|${f.lastModified}|${file.type}` : null;
}

/** Opens (or reuses) a demuxer, so scrubbing thumbnails doesn't re-parse a big moov each time */
export async function withInput<T>(file: Blob, fn: (input: Input) => Promise<T>): Promise<T> {
  const key = inputKey(file);
  let entry = key ? inputs.get(key) : undefined;
  if (!entry) {
    entry = { input: new Input({ source: new BlobSource(file), formats: ALL_FORMATS }), users: 0, stale: !key };
    if (key) inputs.set(key, entry);
    for (const [k, e] of inputs) {
      if (inputs.size <= MAX_INPUTS) break;
      inputs.delete(k);
      e.stale = true;
      if (!e.users) e.input.dispose();
    }
  } else if (key) {
    inputs.delete(key);
    inputs.set(key, entry);
  }
  entry.users++;
  try {
    return await fn(entry.input);
  } finally {
    entry.users--;
    if (entry.stale && !entry.users) entry.input.dispose();
  }
}

async function readable(input: Input) {
  try {
    return await input.canRead();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- encoders

let mp3Ready: Promise<void> | null = null;
let aacReady: Promise<void> | null = null;

async function nativeAudioEncoder(codec: string) {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    return !!(await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 })).supported;
  } catch {
    return false;
  }
}

/**
 * Registers the LAME (mp3) and FFmpeg-AAC wasm encoders when the browser lacks native ones.
 * Must run before mediabunny is asked about these codecs, because it memoises the answers.
 */
export function ensureAudioEncoders(codecs: readonly string[]): Promise<unknown> {
  const jobs: Promise<void>[] = [];
  if (codecs.includes('mp3')) {
    mp3Ready ??= nativeAudioEncoder('mp3').then(async (ok) => {
      if (!ok) (await import('@mediabunny/mp3-encoder')).registerMp3Encoder();
    });
    jobs.push(mp3Ready);
  }
  if (codecs.includes('aac')) {
    aacReady ??= nativeAudioEncoder('mp4a.40.2').then(async (ok) => {
      if (!ok) (await import('@mediabunny/aac-encoder')).registerAacEncoder();
    });
    jobs.push(aacReady);
  }
  return Promise.all(jobs);
}

function outputFormat(c: Container): OutputFormat {
  switch (c) {
    case 'mp4':
    case 'm4a':
      return new Mp4OutputFormat();
    case 'mov':
      return new MovOutputFormat();
    case 'webm':
      return new WebMOutputFormat();
    case 'mkv':
      return new MkvOutputFormat();
    case 'mp3':
      return new Mp3OutputFormat();
    case 'wav':
      return new WavOutputFormat();
    case 'ogg':
      return new OggOutputFormat();
    case 'flac':
      return new FlacOutputFormat();
  }
}

const quality = (o: { bitrate?: number; quality?: QualityLevel }, fallback?: QualityLevel) =>
  o.bitrate ? new Quality({ bitrate: Math.round(o.bitrate) }) : o.quality || fallback ? new Quality(o.quality ?? fallback!) : undefined;

/** like quality(), but explicit bitrates are rounded to ones the audio encoder accepts */
const audioQuality = (codec: AudioCodec, o: { bitrate?: number; quality?: QualityLevel }, fallback?: QualityLevel) =>
  quality({ quality: o.quality, bitrate: o.bitrate ? snapAudioBitrate(codec, o.bitrate) : undefined }, fallback);

const unique = <T,>(list: (T | undefined)[]) => [...new Set(list.filter((x): x is T => x !== undefined))];

async function pickVideoCodec(c: Container, wanted: VideoCodec | undefined, width: number, height: number): Promise<VideoCodec> {
  const list = containers[c].video;
  const codec = await getFirstEncodableVideoCodec(unique([wanted && list.includes(wanted) ? wanted : undefined, ...list]), { width, height });
  if (!codec) throw new MediaError('unsupported-codec', `This browser can't encode video for ${containers[c].label}. Try MP4 or WebM.`);
  return codec as VideoCodec;
}

async function pickAudioCodec(c: Container, wanted: AudioCodec | undefined, numberOfChannels: number, sampleRate: number): Promise<AudioCodec> {
  const list = containers[c].audio;
  const first = wanted && list.includes(wanted) ? wanted : list[0];
  const order = unique([first, ...list]);
  await ensureAudioEncoders([first]);
  let codec = await getFirstEncodableAudioCodec(order, { numberOfChannels, sampleRate });
  // the preferred codec failed: let the wasm encoders (mp3, aac) compete before giving up
  if (codec !== first) {
    await ensureAudioEncoders(order);
    codec = await getFirstEncodableAudioCodec(order, { numberOfChannels, sampleRate });
  }
  if (!codec) throw new MediaError('unsupported-codec', `This browser can't encode audio for ${containers[c].label}.`);
  return codec as AudioCodec;
}

// ---------------------------------------------------------------- output targets

const OPFS_DIR = 'rounder-media';
const OPFS_THRESHOLD = 256 * 1024 * 1024;
let opfsSwept = false;

interface Sink {
  target: Target;
  finish(): Promise<Blob>;
  discard(): Promise<void>;
}

/**
 * Small outputs are built in memory. Big ones stream into the origin-private file system,
 * so a 3 GB export never needs 3 GB of RAM; the resulting File is backed by disk.
 */
async function makeSink(expectedBytes: number, mime: string): Promise<Sink> {
  if (expectedBytes > OPFS_THRESHOLD && typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
      if (!opfsSwept) {
        opfsSwept = true;
        // earlier sessions' exports; anything older than six hours is no longer referenced
        for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
          if (Date.now() - Number(name.split('-')[0]) > 6 * 3600_000) await dir.removeEntry(name).catch(() => {});
        }
      }
      const name = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      return {
        // FileSystemWritableFileStream accepts {type:'write', position, data} chunks, exactly what StreamTarget emits
        target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, { chunked: true }),
        finish: async () => {
          const file = await handle.getFile();
          return new Blob([file], { type: mime });
        },
        discard: async () => {
          await writable.abort().catch(() => {});
          await dir.removeEntry(name).catch(() => {});
        },
      };
    } catch {
      // private browsing / no OPFS: fall through to memory
    }
  }
  const target = new BufferTarget();
  return {
    target,
    finish: async () => new Blob([target.buffer!], { type: mime }),
    discard: async () => {},
  };
}

// ---------------------------------------------------------------- probe

const FORMAT_IDS = [
  [MP4, 'mp4'],
  [QTFF, 'mov'],
  [WEBM, 'webm'],
  [MATROSKA, 'mkv'],
  [MP3, 'mp3'],
  [WAVE, 'wav'],
  [OGG, 'ogg'],
  [ADTS, 'aac'],
  [FLAC, 'flac'],
  [MPEG_TS, 'ts'],
] as const;

async function trackBitrate(track: InputTrack): Promise<number | null> {
  try {
    return (await track.getAverageBitrate()) ?? (await track.getBitrate()) ?? Math.round((await track.computePacketStats(240)).averageBitrate) ?? null;
  } catch {
    return null;
  }
}

export async function probe(file: Blob): Promise<MediaInfo> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (isGif(head)) {
    const gif = parseGif(new Uint8Array(await file.arrayBuffer()));
    const durationSec = gif.frames.reduce((s, f) => s + f.delayMs, 0) / 1000;
    const fps = durationSec ? gif.frames.length / durationSec : null;
    return {
      container: 'gif',
      durationSec,
      sizeBytes: file.size,
      readable: false,
      needsFallback: false,
      via: 'mediabunny',
      video: { codec: 'gif', width: gif.width, height: gif.height, displayWidth: gif.width, displayHeight: gif.height, rotation: 0, fps, bitrate: null, canDecode: true },
    };
  }
  return withInput(file, async (input) => {
    const unknown: MediaInfo = { container: 'unknown', durationSec: 0, sizeBytes: file.size, readable: false, needsFallback: true, via: 'mediabunny' };
    if (!(await readable(input))) return unknown;
    const format = await input.getFormat();
    const [v, a] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    let container: string = FORMAT_IDS.find(([f]) => f === format)?.[1] ?? format.name.toLowerCase();
    if (container === 'mp4' && !v) container = 'm4a';
    const info: MediaInfo = { container, durationSec: await input.computeDuration(), sizeBytes: file.size, readable: true, needsFallback: false, via: 'mediabunny' };
    if (v) {
      const fps = await v.computeFrameRateMetrics({ targetPacketCount: 120 }).then((m) => m.bestGuessFrameRate, () => null);
      info.video = {
        codec: await v.getCodec(),
        width: await v.getCodedWidth(),
        height: await v.getCodedHeight(),
        displayWidth: await v.getDisplayWidth(),
        displayHeight: await v.getDisplayHeight(),
        rotation: await v.getRotation(),
        fps: fps ? Math.round(fps * 1000) / 1000 : null,
        bitrate: await trackBitrate(v),
        canDecode: await v.canDecode(),
      };
    }
    if (a) {
      info.audio = {
        codec: await a.getCodec(),
        sampleRate: await a.getSampleRate(),
        channels: await a.getNumberOfChannels(),
        bitrate: await trackBitrate(a),
        canDecode: await a.canDecode(),
      };
    }
    info.needsFallback = (!!info.video && !info.video.canDecode) || (!!info.audio && !info.audio.canDecode);
    return info;
  });
}

// ---------------------------------------------------------------- capabilities

let caps: Promise<Capabilities> | null = null;

export function capabilities(): Promise<Capabilities> {
  caps ??= (async () => {
    const videoCodecs: VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1', 'vp8'];
    const [vEnc, vDec, aEncNative, aDec, nativeAac] = await Promise.all([
      getEncodableVideoCodecs(videoCodecs, { width: 1280, height: 720 }),
      getDecodableVideoCodecs(videoCodecs),
      // aac/mp3 are reported without asking mediabunny: their wasm fallbacks always work, and checking
      // would mean downloading them (registering one later clears mediabunny's memo, so order is safe)
      getEncodableAudioCodecs(['opus', 'flac', 'vorbis', 'pcm-s16', 'pcm-s24', 'pcm-f32']),
      getDecodableAudioCodecs(['aac', 'opus', 'mp3', 'flac', 'vorbis', 'pcm-s16']),
      nativeAudioEncoder('mp4a.40.2'),
    ]);
    const audioEncode = unique<AudioCodec>(['aac', 'mp3', ...(aEncNative as AudioCodec[])]);
    const ok = (c: Container) =>
      containers[c].audio.some((a) => audioEncode.includes(a)) && (isAudioContainer(c) || containers[c].video.some((v) => vEnc.includes(v)));
    return {
      webCodecs: {
        videoEncoder: typeof VideoEncoder !== 'undefined',
        videoDecoder: typeof VideoDecoder !== 'undefined',
        audioEncoder: typeof AudioEncoder !== 'undefined',
        audioDecoder: typeof AudioDecoder !== 'undefined',
      },
      video: { encode: vEnc as VideoCodec[], decode: vDec as VideoCodec[] },
      audio: { encode: audioEncode, decode: aDec as AudioCodec[], nativeAac },
      containers: Object.fromEntries((Object.keys(containers) as Container[]).map((c) => [c, ok(c)])) as Record<Container, boolean>,
      imageDecoder: typeof ImageDecoder !== 'undefined',
    };
  })();
  return caps;
}

// ---------------------------------------------------------------- transcode

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), { width, height });
}

function context2d(canvas: OffscreenCanvas | HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): Ctx2D {
  return canvas.getContext('2d', opts) as Ctx2D;
}

/** copies an AudioSample into one Float32Array per channel */
function planesOf(s: AudioSample): Float32Array[] {
  return Array.from({ length: s.numberOfChannels }, (_, c) => {
    const plane = new Float32Array(s.numberOfFrames);
    s.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
    return plane;
  });
}

function sampleFromPlanes(planes: Float32Array[], sampleRate: number, timestamp: number): AudioSample {
  const frames = planes[0]?.length ?? 0;
  const data = new Float32Array(frames * planes.length);
  planes.forEach((p, c) => data.set(p, c * frames));
  return new AudioSample({ data, format: 'f32-planar', numberOfChannels: planes.length, sampleRate, timestamp });
}

/** gain and tape-style speed, applied to each decoded audio chunk before encoding */
function audioProcessor(gainDb: number, speed: number) {
  if (!gainDb && speed === 1) return undefined;
  const g = dbToGain(gainDb);
  let resampler: Resampler | null = null;
  let start: number | null = null;
  let written = 0;
  return (s: AudioSample): AudioSample | null => {
    let planes = planesOf(s);
    if (speed !== 1) planes = (resampler ??= new Resampler(speed, planes.length)).process(planes);
    if (g !== 1) for (const p of planes) for (let i = 0; i < p.length; i++) p[i] = clamp(p[i] * g, -1, 1);
    const frames = planes[0]?.length ?? 0;
    if (!frames) return null;
    start ??= s.timestamp / speed;
    // sped-up audio is laid end to end; at normal speed keep the source timestamps (gaps stay gaps)
    const timestamp = speed === 1 ? s.timestamp : start + written / s.sampleRate;
    written += frames;
    return sampleFromPlanes(planes, s.sampleRate, timestamp);
  };
}

interface VideoHookPlan {
  width: number;
  height: number;
  speed: number;
  fpsCap?: number;
  overlay?: VideoOptions['overlay'];
  render?: VideoOptions['render'];
}

function videoProcessor(p: VideoHookPlan) {
  const hook = p.render ?? p.overlay;
  if (!hook && p.speed === 1) return undefined;
  const canvas = hook ? createCanvas(p.width, p.height) : null;
  const ctx = canvas ? context2d(canvas) : null;
  let index = 0;
  let last = -Infinity;
  return async (sample: VideoSample) => {
    const time = sample.timestamp / p.speed;
    const duration = sample.duration / p.speed;
    // speeding up multiplies the frame rate; drop frames that would exceed the cap
    if (p.speed !== 1 && p.fpsCap && time < last + 1 / p.fpsCap - 1e-6) return null;
    last = time;
    const frame = { time, index: index++, width: p.width, height: p.height };
    if (!canvas || !ctx) {
      sample.setTimestamp(time);
      sample.setDuration(duration);
      return sample;
    }
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, p.width, p.height);
    if (p.render) await p.render(ctx, sample, frame);
    else {
      sample.draw(ctx, 0, 0, p.width, p.height);
      await p.overlay!(ctx, frame);
    }
    ctx.restore();
    return new VideoSample(canvas, { timestamp: time, duration });
  };
}

function discardError(conversion: Conversion, track: InputTrack | null) {
  const d = conversion.discardedTracks.find((x) => x.track === track);
  if (!d || d.reason === 'discarded_by_user') return null;
  const kind = track?.isVideoTrack() ? 'video' : 'audio';
  if (d.reason === 'undecodable_source_codec' || d.reason === 'unknown_source_codec') {
    return new MediaError('unsupported-input', `This browser can't decode the ${kind} in this file.`);
  }
  if (d.reason === 'no_encodable_target_codec') return new MediaError('unsupported-codec', `This browser can't encode ${kind} for this format.`);
  return new MediaError('failed', `The ${kind} track couldn't be converted (${d.reason}).`);
}

async function run(conversions: Conversion[], output: Output, sink: Sink, ctl: JobControl, composable: boolean) {
  const progress = conversions.map(() => 0);
  conversions.forEach((c, i) => {
    c.onProgress = (p) => {
      progress[i] = p;
      ctl.onProgress?.(progress.reduce((a, b) => a + b, 0) / progress.length);
    };
  });
  const cancel = () => conversions.forEach((c) => void c.cancel());
  ctl.signal?.addEventListener('abort', cancel);
  try {
    throwIfAborted(ctl.signal);
    if (composable) await output.start();
    await Promise.all(conversions.map((c) => c.execute()));
    if (composable) await output.finalize();
  } catch (e) {
    if (composable && output.state !== 'finalized') await output.cancel().catch(() => {});
    await sink.discard();
    throw ctl.signal?.aborted ? new MediaError('aborted', 'Cancelled.') : toMediaError(e);
  } finally {
    ctl.signal?.removeEventListener('abort', cancel);
  }
}

/** Converts, compresses, trims, crops, rotates, re-times, mutes or re-voices a file with WebCodecs. */
export async function transcode(file: Blob, o: TranscodeOptions, ctl: JobControl = {}): Promise<TranscodeResult> {
  const c = containers[o.container];
  if (!c) throw new MediaError('invalid-options', `Unknown container "${o.container}".`);
  return withInput(file, async (input) => {
    if (!(await readable(input))) throw new MediaError('unsupported-input', "This file's format isn't supported by the browser.");
    const [vTrack, aTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const duration = await input.computeDuration();
    const start = clamp(o.trim?.start ?? 0, 0, duration);
    const end = clamp(o.trim?.end ?? duration, start, duration);
    const vo: VideoOptions = o.video || {};
    const ao = o.audio || {};
    const speed = clamp(vo.speed ?? 1, 0.25, 4);
    const outDuration = (end - start) / speed;
    const notes: string[] = [];

    const wantVideo = !!vTrack && o.video !== false && !isAudioContainer(o.container);
    const replace = o.audio !== false ? ao.replace : undefined;
    const wantAudio = o.audio !== false && (!!aTrack || !!replace);
    if (!wantVideo && !wantAudio) throw new MediaError('no-tracks', isAudioContainer(o.container) ? 'This file has no audio.' : 'This file has no video or audio to convert.');
    if (end - start <= 0) throw new MediaError('invalid-options', 'The selected range is empty.');

    // target size splits one budget between video and audio
    let videoBitrate = vo.bitrate;
    let audioBitrate = ao.bitrate;
    if (wantVideo && !videoBitrate && vo.targetSizeBytes) {
      const guess = ao.codec && c.audio.includes(ao.codec) ? ao.codec : c.audio[0];
      const split = bitrateForTargetSize(vo.targetSizeBytes, outDuration, {
        audioBitrate: wantAudio ? (audioBitrate ?? 128_000) : 0,
        snapAudio: (b) => snapAudioBitrate(guess, b) ?? b,
      });
      videoBitrate = split.videoBitrate;
      if (wantAudio) audioBitrate = split.audioBitrate;
      if (!split.feasible) notes.push('The target size is very small for this length; the result will be larger than requested.');
    }

    let video: ConversionVideoOptions = { discard: true };
    let width: number | undefined;
    let height: number | undefined;
    if (wantVideo && vTrack) {
      let rotate = vo.rotate ?? 0;
      let flip = !!vo.flipHorizontal;
      // a vertical flip is a horizontal flip of the frame turned 180°
      if (vo.flipVertical) {
        rotate = ((rotate + 180) % 360) as typeof rotate;
        flip = !flip;
      }
      const dw = await vTrack.getDisplayWidth();
      const dh = await vTrack.getDisplayHeight();
      const plan = planVideoSize(dw, dh, { ...vo, rotate });
      const resize = !!(vo.width || vo.height || (vo.scale && vo.scale !== 1));
      const hooks = !!(vo.overlay || vo.render);
      const transcodeVideo = resize || hooks || speed !== 1 || !!(vo.crop || rotate || flip || vo.fps || videoBitrate || vo.quality || vo.codec);
      const sourceFps = await vTrack.computeFrameRateMetrics({ targetPacketCount: 120 }).then((m) => m.bestGuessFrameRate, () => 0);
      const process = videoProcessor({ width: plan.width, height: plan.height, speed, fpsCap: vo.fps ?? (speed > 1 ? 60 : undefined), overlay: vo.overlay, render: vo.render });
      video = {
        rotate,
        flip,
        crop: vo.crop ? { left: Math.round(vo.crop.x), top: Math.round(vo.crop.y), width: Math.round(vo.crop.width), height: Math.round(vo.crop.height) } : undefined,
        // only cap: asking for more fps than the source would just duplicate frames
        frameRate: speed === 1 && vo.fps && (!sourceFps || vo.fps < sourceFps - 0.01) ? vo.fps : undefined,
        keyFrameInterval: vo.keyFrameInterval,
        allowTransformationMetadata: false,
        forceTranscode: transcodeVideo,
        process,
      };
      if (transcodeVideo) {
        video.codec = await pickVideoCodec(o.container, vo.codec, plan.width, plan.height);
        if (vo.codec && video.codec !== vo.codec) notes.push(`This browser can't encode ${vo.codec.toUpperCase()}; used ${video.codec.toUpperCase()} instead.`);
        video.quality = quality({ bitrate: videoBitrate, quality: vo.quality }, 'high');
        if (vo.render) {
          // the hook does the resizing itself, so mediabunny hands it the full-size frame
          video.processedWidth = plan.width;
          video.processedHeight = plan.height;
        } else if (resize || vo.crop || dw % 2 || dh % 2) {
          video.width = plan.width;
          video.height = plan.height;
          video.fit = plan.fit;
        }
        width = plan.width;
        height = plan.height;
      } else {
        width = dw;
        height = dh;
      }
    }

    const audioOptions = async (track: InputAudioTrack, forReplace: boolean): Promise<ConversionAudioOptions> => {
      const audioSpeed = forReplace ? 1 : speed;
      const channels = ao.channels ?? Math.min(2, await track.getNumberOfChannels());
      const rate = ao.sampleRate ?? (await track.getSampleRate());
      const process = audioProcessor(ao.gainDb ?? 0, audioSpeed);
      const reencode = !!(process || ao.codec || audioBitrate || ao.quality || ao.sampleRate || ao.channels);
      const opts: ConversionAudioOptions = { numberOfChannels: ao.channels ?? (channels < (await track.getNumberOfChannels()) ? channels : undefined), sampleRate: ao.sampleRate, forceTranscode: reencode, process };
      if (reencode || !c.audio.includes((await track.getCodec()) as AudioCodec)) {
        opts.codec = await pickAudioCodec(o.container, ao.codec, channels, encoderSampleRate(ao.codec ?? c.audio[0], rate));
        opts.quality = audioQuality(opts.codec, { bitrate: audioBitrate, quality: ao.quality }, 'high');
        if (opts.codec !== ao.codec && ao.codec) notes.push(`This browser can't encode ${ao.codec.toUpperCase()}; used ${opts.codec.toUpperCase()} instead.`);
        const encRate = encoderSampleRate(opts.codec, rate);
        if (encRate !== rate) opts.sampleRate = encRate;
      }
      return opts;
    };

    const audio: ConversionAudioOptions = wantAudio && aTrack && !replace ? await audioOptions(aTrack, false) : { discard: true };
    if (wantAudio && speed !== 1 && !replace) notes.push('Audio pitch follows the speed change.');

    const sink = await makeSink(file.size, c.mime);
    const output = new Output({ format: outputFormat(o.container), target: sink.target });
    const tags = o.keepMetadata === false ? {} : undefined;
    const base = { input, output, trim: o.trim ? { start, end } : undefined, tracks: 'primary' as const, showWarnings: false, tags };
    const main = await Conversion.init({ ...base, video, audio, composable: !!replace });
    const err = (wantVideo && discardError(main, vTrack)) || (wantAudio && !replace && discardError(main, aTrack));
    if (err) throw err;
    if (!main.isValid) throw new MediaError('failed', 'Nothing in this file can be converted to that format.');

    if (replace) {
      await withInput(replace, async (rin) => {
        const rTrack = (await readable(rin)) ? await rin.getPrimaryAudioTrack() : null;
        if (!rTrack) throw new MediaError('no-tracks', 'The replacement file has no audio.');
        const offset = ao.replaceOffset ?? 0;
        const sideOutDuration = wantVideo ? outDuration : await rin.computeDuration();
        const side = await Conversion.init({
          input: rin,
          output,
          trim: { start: offset, end: offset + sideOutDuration },
          tracks: 'primary',
          showWarnings: false,
          video: { discard: true },
          audio: await audioOptions(rTrack, true),
          composable: true,
        });
        const sideErr = discardError(side, rTrack);
        if (sideErr) throw sideErr;
        await run([main, side], output, sink, ctl, true);
      });
    } else {
      await run([main], output, sink, ctl, false);
    }

    return {
      blob: await sink.finish(),
      container: o.container,
      mimeWithCodecs: await output.getMimeType().catch(() => c.mime),
      width,
      height,
      durationSec: outDuration,
      notes,
      via: 'mediabunny' as const,
    };
  });
}

// ---------------------------------------------------------------- frames

export interface FramesRequest {
  /** exact times in seconds… */
  times?: number[];
  /** …or this many evenly spread across [start, end] */
  count?: number;
  start?: number;
  end?: number;
  /** thumbnail size; give one side to keep the aspect ratio */
  width?: number;
  height?: number;
  fit?: 'contain' | 'cover' | 'fill';
}

/** Decodes thumbnails/stills. `onFrame` receives each one as soon as it is ready. */
export async function extractFrames(file: Blob, req: FramesRequest, ctl: JobControl & { onFrame?: (f: Frame, i: number) => void } = {}): Promise<Frame[]> {
  return withInput(file, async (input) => {
    const track = await primaryVideo(input);
    const first = Math.max(0, await track.getFirstTimestamp());
    const duration = await input.computeDuration();
    const times = (req.times ?? spreadTimes(req.count ?? 10, req.start ?? first, req.end ?? duration)).map((t) => clamp(t, first, duration)).sort((a, b) => a - b);
    const sink = new CanvasSink(track, { width: req.width ? Math.round(req.width) : undefined, height: req.height ? Math.round(req.height) : undefined, fit: req.width && req.height ? (req.fit ?? 'cover') : undefined });
    const frames: Frame[] = [];
    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      throwIfAborted(ctl.signal);
      const time = times[i++];
      if (!wrapped) continue;
      const frame = { time, bitmap: await createImageBitmap(wrapped.canvas) };
      // the index is the frame's position in the (sorted) request, so streamed frames can be placed
      if (ctl.onFrame) ctl.onFrame(frame, i - 1);
      else frames.push(frame);
      ctl.onProgress?.(i / times.length);
    }
    return frames;
  });
}

// ---------------------------------------------------------------- audio

export interface DecodeAudioOptions {
  start?: number;
  end?: number;
  /** resample to this rate (linear; fine for analysis and previews) */
  sampleRate?: number;
  mono?: boolean;
}

const unreadable = () => new MediaError('unsupported-input', "This file's format isn't supported by the browser.");

async function primaryVideo(input: Input) {
  if (!(await readable(input))) throw unreadable();
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new MediaError('no-tracks', 'This file has no video.');
  if (!(await track.canDecode())) throw new MediaError('unsupported-input', "This browser can't decode this video.");
  return track;
}

async function primaryAudio(input: Input) {
  if (!(await readable(input))) throw unreadable();
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new MediaError('no-tracks', 'This file has no audio.');
  if (!(await track.canDecode())) throw new MediaError('unsupported-input', "This browser can't decode this audio.");
  return track;
}

/** Iterates decoded audio between start and end as planar Float32 chunks, trimmed exactly */
async function* audioChunks(track: InputAudioTrack, start: number, end: number, signal?: AbortSignal) {
  for await (const s of new AudioSampleSink(track).samples(start, end)) {
    try {
      throwIfAborted(signal);
      const from = Math.max(0, Math.round((start - s.timestamp) * s.sampleRate));
      const to = Math.min(s.numberOfFrames, Math.round((end - s.timestamp) * s.sampleRate));
      if (to <= from) continue;
      const planes = planesOf(s).map((p) => (from > 0 || to < p.length ? p.slice(from, to) : p));
      yield { planes, sampleRate: s.sampleRate, time: s.timestamp + from / s.sampleRate };
    } finally {
      s.close();
    }
  }
}

export async function decodeAudio(file: Blob, o: DecodeAudioOptions = {}, ctl: JobControl = {}): Promise<Pcm> {
  return withInput(file, async (input) => {
    const track = await primaryAudio(input);
    const duration = await input.computeDuration();
    const start = clamp(o.start ?? 0, 0, duration);
    const end = clamp(o.end ?? duration, start, duration);
    let sampleRate = await track.getSampleRate();
    const parts: Float32Array[][] = [];
    for await (const chunk of audioChunks(track, start, end, ctl.signal)) {
      sampleRate = chunk.sampleRate;
      parts.push(chunk.planes);
      ctl.onProgress?.((chunk.time - start) / Math.max(1e-6, end - start));
    }
    const channelCount = parts[0]?.length ?? (await track.getNumberOfChannels());
    const total = parts.reduce((n, p) => n + p[0].length, 0);
    let channels: Float32Array[] = Array.from({ length: channelCount }, (_, c) => {
      const out = new Float32Array(total);
      let off = 0;
      for (const p of parts) {
        out.set(p[c] ?? p[0], off);
        off += p[0].length;
      }
      return out;
    });
    if (o.mono) channels = [mixdown(channels)];
    const pcm = { sampleRate, channels };
    return o.sampleRate ? resample(pcm, o.sampleRate) : pcm;
  });
}

/** Waveform peaks streamed straight from the file; never holds the decoded audio */
export async function waveform(file: Blob, buckets: number, o: { start?: number; end?: number } = {}, ctl: JobControl = {}): Promise<Peaks> {
  return withInput(file, async (input) => {
    const track = await primaryAudio(input);
    const duration = await input.computeDuration();
    const start = clamp(o.start ?? 0, 0, duration);
    const end = clamp(o.end ?? duration, start, duration);
    const acc = new PeakAccumulator(Math.ceil((end - start) * (await track.getSampleRate())), Math.max(1, Math.floor(buckets)));
    for await (const chunk of audioChunks(track, start, end, ctl.signal)) {
      acc.push(chunk.planes);
      ctl.onProgress?.((chunk.time - start) / Math.max(1e-6, end - start));
    }
    return acc.result();
  });
}

export interface EncodeAudioOptions {
  format: 'wav' | 'mp3' | 'm4a' | 'ogg' | 'flac' | 'webm';
  codec?: AudioCodec;
  bitrate?: number;
  quality?: QualityLevel;
}

/** Encodes PCM to a file. WAV is written directly; everything else goes through an encoder. */
export async function encodeAudio(pcm: Pcm, o: EncodeAudioOptions, ctl: JobControl = {}): Promise<Blob> {
  if (o.format === 'wav') {
    const fmt = o.codec === 'pcm-s24' || o.codec === 'pcm-f32' ? o.codec : 'pcm-s16';
    return new Blob([writeWav(pcm, fmt)], { type: 'audio/wav' });
  }
  const c = containers[o.format];
  const frames = pcm.channels[0]?.length ?? 0;
  const codec = await pickAudioCodec(o.format, o.codec, Math.min(2, pcm.channels.length), encoderSampleRate(o.codec ?? c.audio[0], pcm.sampleRate));
  const rate = encoderSampleRate(codec, pcm.sampleRate);
  const channels = codec === 'mp3' ? Math.min(2, pcm.channels.length) : pcm.channels.length;
  const target = new BufferTarget();
  const output = new Output({ format: outputFormat(o.format), target });
  const source = new AudioSampleSource({
    codec,
    quality: audioQuality(codec, o, 'high'),
    transform: { sampleRate: rate !== pcm.sampleRate ? rate : undefined, numberOfChannels: channels !== pcm.channels.length ? channels : undefined },
  });
  output.addAudioTrack(source);
  try {
    await output.start();
    const step = pcm.sampleRate; // one-second chunks
    for (let i = 0; i < frames; i += step) {
      throwIfAborted(ctl.signal);
      const sample = sampleFromPlanes(pcm.channels.map((ch) => ch.subarray(i, i + step)), pcm.sampleRate, i / pcm.sampleRate);
      await source.add(sample);
      sample.close();
      ctl.onProgress?.(Math.min(1, (i + step) / frames));
    }
    source.close();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw toMediaError(e);
  }
  return new Blob([target.buffer!], { type: c.mime });
}

// ---------------------------------------------------------------- concat

export interface ConcatOptions {
  container: Container;
  /** output size; defaults to the first video's size. Mismatched clips are letterboxed. */
  width?: number;
  height?: number;
  codec?: VideoCodec;
  audioCodec?: AudioCodec;
  quality?: QualityLevel;
  bitrate?: number;
  background?: string;
}

/** Joins clips (or audio files) end to end, re-encoding to one size and codec. */
export async function concat(files: Blob[], o: ConcatOptions, ctl: JobControl = {}): Promise<TranscodeResult> {
  if (!files.length) throw new MediaError('invalid-options', 'Nothing to join.');
  const c = containers[o.container];
  const infos = await Promise.all(files.map((f) => probe(f)));
  infos.forEach((info, i) => {
    if (!info.readable || info.needsFallback) throw new MediaError('unsupported-input', `File ${i + 1} can't be decoded by this browser.`);
  });
  const hasVideo = !isAudioContainer(o.container) && infos.some((i) => i.video);
  const hasAudio = infos.some((i) => i.audio);
  const firstVideo = infos.find((i) => i.video)?.video;
  const W = evenize(o.width ?? firstVideo?.displayWidth ?? 1280);
  const H = evenize(o.height ?? firstVideo?.displayHeight ?? 720);
  const rate = 48000;
  const total = infos.reduce((s, i) => s + i.durationSec, 0);

  const sink = await makeSink(files.reduce((s, f) => s + f.size, 0), c.mime);
  const output = new Output({ format: outputFormat(o.container), target: sink.target });
  let vSource: VideoSampleSource | null = null;
  let aSource: AudioSampleSource | null = null;
  if (hasVideo) {
    const codec = await pickVideoCodec(o.container, o.codec, W, H);
    vSource = new VideoSampleSource({ codec, quality: quality(o, 'high') });
    output.addVideoTrack(vSource);
  }
  if (hasAudio) {
    const codec = await pickAudioCodec(o.container, o.audioCodec, 2, rate);
    aSource = new AudioSampleSource({ codec, quality: new Quality('high') });
    output.addAudioTrack(aSource);
  }
  const canvas = createCanvas(W, H);
  const ctx = context2d(canvas);
  const cancel = () => void output.cancel();
  ctl.signal?.addEventListener('abort', cancel);
  try {
    await output.start();
    let offset = 0;
    for (const [i, file] of files.entries()) {
      throwIfAborted(ctl.signal);
      const info = infos[i];
      await withInput(file, async (input) => {
        const v = await input.getPrimaryVideoTrack();
        const a = await input.getPrimaryAudioTrack();
        const first = Math.max(0, await input.getFirstTimestamp());
        const length = info.durationSec - first;
        const jobs: Promise<void>[] = [];
        if (vSource) {
          const src = vSource;
          const draw = (sample: VideoSample | null) => {
            ctx.fillStyle = o.background ?? '#000';
            ctx.fillRect(0, 0, W, H);
            sample?.drawWithFit(ctx, { fit: 'contain' });
          };
          jobs.push(
            (async () => {
              if (!v) {
                draw(null); // audio-only clip in a video: hold a black frame
                const black = new VideoSample(canvas, { timestamp: offset, duration: length });
                await src.add(black);
                black.close();
                return;
              }
              for await (const s of new VideoSampleSink(v).samples()) {
                throwIfAborted(ctl.signal);
                draw(s);
                const t = offset + Math.max(0, s.timestamp - first);
                const frame = new VideoSample(canvas, { timestamp: t, duration: s.duration });
                s.close();
                await src.add(frame);
                frame.close();
                ctl.onProgress?.(t / total);
              }
            })(),
          );
        }
        if (aSource) {
          const src = aSource;
          jobs.push(
            (async () => {
              // lay audio end to end at 48 kHz stereo, padding with silence up to the clip length
              let written = 0;
              const push = async (planes: Float32Array[]) => {
                const sample = sampleFromPlanes(planes, rate, offset + written / rate);
                written += planes[0].length;
                await src.add(sample);
                sample.close();
              };
              if (a) {
                let resampler: Resampler | null = null;
                for await (const chunk of audioChunks(a, first, info.durationSec, ctl.signal)) {
                  let planes = chunk.planes.length === 1 ? [chunk.planes[0], chunk.planes[0]] : chunk.planes.slice(0, 2);
                  if (chunk.sampleRate !== rate) planes = (resampler ??= new Resampler(chunk.sampleRate / rate, 2)).process(planes);
                  if (planes[0].length) await push(planes);
                }
              }
              const missing = Math.round(length * rate) - written;
              for (let left = missing; left > 0; left -= rate) await push([new Float32Array(Math.min(rate, left)), new Float32Array(Math.min(rate, left))]);
            })(),
          );
        }
        await Promise.all(jobs);
        offset += length;
      });
    }
    vSource?.close();
    aSource?.close();
    await output.finalize();
  } catch (e) {
    if (output.state !== 'finalized') await output.cancel().catch(() => {});
    await sink.discard();
    throw ctl.signal?.aborted ? new MediaError('aborted', 'Cancelled.') : toMediaError(e);
  } finally {
    ctl.signal?.removeEventListener('abort', cancel);
  }
  return {
    blob: await sink.finish(),
    container: o.container,
    mimeWithCodecs: await output.getMimeType().catch(() => c.mime),
    width: hasVideo ? W : undefined,
    height: hasVideo ? H : undefined,
    durationSec: total,
    notes: [],
    via: 'mediabunny',
  };
}

// ---------------------------------------------------------------- slideshow

export interface SlideshowOptions {
  container?: 'mp4' | 'webm' | 'mov' | 'mkv';
  width?: number;
  height?: number;
  fps?: number;
  /** seconds per image: one value for all, or one per image */
  durations?: number | number[];
  transition?: 'none' | 'fade' | 'slide';
  transitionSec?: number;
  fit?: 'contain' | 'cover';
  background?: string;
  /** slow zoom across each slide */
  kenBurns?: boolean;
  codec?: VideoCodec;
  quality?: QualityLevel;
  /** soundtrack, cut to the slideshow length and faded out */
  audio?: Blob;
  audioFadeSec?: number;
}

function drawImageFit(ctx: Ctx2D, img: ImageBitmap, W: number, H: number, fit: 'contain' | 'cover', zoom = 1, dx = 0, alpha = 1) {
  const s = (fit === 'cover' ? Math.max(W / img.width, H / img.height) : Math.min(W / img.width, H / img.height)) * zoom;
  const w = img.width * s;
  const h = img.height * s;
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, (W - w) / 2 + dx, (H - h) / 2, w, h);
  ctx.globalAlpha = 1;
}

/** Renders still images into a video with optional transitions, Ken Burns zoom and a soundtrack. */
export async function imagesToVideo(images: (Blob | ImageBitmap)[], o: SlideshowOptions = {}, ctl: JobControl = {}): Promise<TranscodeResult> {
  if (!images.length) throw new MediaError('invalid-options', 'Add at least one image.');
  const container = o.container ?? 'mp4';
  const c = containers[container];
  const W = evenize(o.width ?? 1280);
  const H = evenize(o.height ?? 720);
  const fps = o.fps ?? 30;
  const durs = images.map((_, i) => (Array.isArray(o.durations) ? (o.durations[i] ?? 3) : (o.durations ?? 3)));
  const total = durs.reduce((a, b) => a + b, 0);
  const T = o.transition && o.transition !== 'none' ? Math.min(o.transitionSec ?? 0.6, ...durs.map((d) => d / 2)) : 0;
  const fit = o.fit ?? 'cover';

  const canvas = createCanvas(W, H);
  const ctx = context2d(canvas);
  const output = new Output({ format: outputFormat(container), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: await pickVideoCodec(container, o.codec, W, H), quality: new Quality(o.quality ?? 'high') });
  output.addVideoTrack(video, { frameRate: fps });
  let audio: AudioSampleSource | null = null;
  let soundtrack: Promise<void> | null = null;
  const loaded = new Map<number, ImageBitmap>();
  const load = async (i: number) => {
    let bmp = loaded.get(i);
    if (!bmp) {
      const src = images[i];
      bmp = src instanceof Blob ? await createImageBitmap(src) : src;
      loaded.set(i, bmp);
    }
    return bmp;
  };

  const audioDone = async (rin: Input) => {
    const track = await primaryAudio(rin);
    const fadeSec = o.audioFadeSec ?? 1.5;
    for await (const chunk of audioChunks(track, 0, total, ctl.signal)) {
      const planes = chunk.planes;
      // fade the tail so the music doesn't stop dead
      const n = planes[0].length;
      for (let k = 0; k < n; k++) {
        const left = total - (chunk.time + k / chunk.sampleRate);
        if (left < fadeSec) for (const p of planes) p[k] *= Math.max(0, left / fadeSec);
      }
      const sample = sampleFromPlanes(planes, chunk.sampleRate, chunk.time);
      await audio!.add(sample);
      sample.close();
    }
  };

  try {
    if (o.audio) {
      const rate = 48000;
      audio = new AudioSampleSource({ codec: await pickAudioCodec(container, undefined, 2, rate), quality: new Quality('high'), transform: { sampleRate: rate, numberOfChannels: 2 } });
      output.addAudioTrack(audio);
    }
    await output.start();
    // the soundtrack is pumped alongside the frames; its error (if any) surfaces after the video loop
    let soundtrackError: unknown = null;
    if (o.audio && audio) soundtrack = withInput(o.audio, audioDone).then(() => audio!.close(), (e) => void (soundtrackError = e));

    const frames = Math.max(1, Math.round(total * fps));
    let slot = 0;
    let slotStart = 0;
    for (let n = 0; n < frames; n++) {
      throwIfAborted(ctl.signal);
      const t = n / fps;
      while (slot < images.length - 1 && t >= slotStart + durs[slot]) {
        if (images[slot] instanceof Blob) loaded.get(slot)?.close();
        loaded.delete(slot);
        slotStart += durs[slot++];
      }
      const local = (t - slotStart) / durs[slot];
      ctx.fillStyle = o.background ?? '#000';
      ctx.fillRect(0, 0, W, H);
      const zoom = (p: number) => (o.kenBurns ? 1 + 0.08 * p : 1);
      const into = t - (slotStart + durs[slot] - T);
      if (T > 0 && slot < images.length - 1 && into > 0) {
        const k = into / T;
        const ease = k * k * (3 - 2 * k);
        if (o.transition === 'slide') {
          drawImageFit(ctx, await load(slot), W, H, fit, zoom(local), -W * ease);
          drawImageFit(ctx, await load(slot + 1), W, H, fit, zoom(0), W * (1 - ease));
        } else {
          drawImageFit(ctx, await load(slot), W, H, fit, zoom(local));
          drawImageFit(ctx, await load(slot + 1), W, H, fit, zoom(0), 0, ease);
        }
      } else {
        drawImageFit(ctx, await load(slot), W, H, fit, zoom(local));
      }
      await video.add(t, 1 / fps);
      ctl.onProgress?.((n + 1) / frames);
    }
    video.close();
    await soundtrack;
    if (soundtrackError) throw soundtrackError;
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw toMediaError(e);
  } finally {
    for (const [i, b] of loaded) if (images[i] instanceof Blob) b.close();
  }
  return {
    blob: new Blob([(output.target as BufferTarget).buffer!], { type: c.mime }),
    container,
    mimeWithCodecs: await output.getMimeType().catch(() => c.mime),
    width: W,
    height: H,
    durationSec: total,
    notes: [],
    via: 'mediabunny',
  };
}

// ---------------------------------------------------------------- gif

export interface GifOptions {
  fps?: number;
  /** output width; height follows the aspect ratio */
  width?: number;
  start?: number;
  end?: number;
  /** palette size per frame, 2–256 */
  colors?: number;
  /** 0 = loop forever, -1 = play once */
  loop?: number;
}

/** Video → animated GIF, one palette per frame for the best colours */
export async function videoToGif(file: Blob, o: GifOptions = {}, ctl: JobControl = {}): Promise<Blob> {
  return withInput(file, async (input) => {
    const track = await primaryVideo(input);
    const duration = await input.computeDuration();
    const fps = clamp(o.fps ?? 12, 1, 50);
    const start = clamp(o.start ?? 0, 0, duration);
    const end = clamp(o.end ?? duration, start, duration);
    const times: number[] = [];
    for (let t = start; t < end - 1e-6; t += 1 / fps) times.push(t);
    const width = Math.min(o.width ?? 480, await track.getDisplayWidth());
    const sink = new CanvasSink(track, { width: Math.round(width) });
    const gif = GIFEncoder();
    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      throwIfAborted(ctl.signal);
      if (!wrapped) continue;
      const { canvas } = wrapped;
      const data = context2d(canvas, { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
      const palette = quantize(data, clamp(o.colors ?? 256, 2, 256));
      // GIF delays are centiseconds; accumulate so rounding doesn't drift the speed
      const delay = (Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps)) * 10;
      gif.writeFrame(applyPalette(data, palette), canvas.width, canvas.height, { palette, delay, repeat: o.loop ?? 0 });
      ctl.onProgress?.(++i / times.length);
    }
    gif.finish();
    return new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
  });
}

export interface DecodedGif {
  width: number;
  height: number;
  frames: { bitmap: ImageBitmap; delayMs: number }[];
}

/** Streams GIF frames as ImageBitmaps: ImageDecoder where available, else the TS decoder */
async function* gifFrames(file: Blob, signal?: AbortSignal): AsyncGenerator<{ bitmap: ImageBitmap; delayMs: number; width: number; height: number }> {
  if (typeof ImageDecoder !== 'undefined' && (await ImageDecoder.isTypeSupported('image/gif'))) {
    const decoder = new ImageDecoder({ data: file.stream(), type: 'image/gif' });
    try {
      await decoder.completed;
      const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
      for (let i = 0; i < count; i++) {
        throwIfAborted(signal);
        const { image } = await decoder.decode({ frameIndex: i });
        const delay = (image.duration ?? 100_000) / 1000;
        const bitmap = await createImageBitmap(image);
        yield { bitmap, delayMs: delay < 20 ? 100 : delay, width: image.displayWidth, height: image.displayHeight };
        image.close();
      }
      return;
    } finally {
      decoder.close();
    }
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { width, height } = parseGif(bytes);
  for (const f of decodeGifFrames(bytes)) {
    throwIfAborted(signal);
    yield { bitmap: await createImageBitmap(new ImageData(f.rgba as Uint8ClampedArray<ArrayBuffer>, width, height)), delayMs: f.delayMs, width, height };
  }
}

export async function decodeGif(file: Blob, ctl: JobControl = {}): Promise<DecodedGif> {
  const frames: DecodedGif['frames'] = [];
  let width = 0;
  let height = 0;
  for await (const f of gifFrames(file, ctl.signal)) {
    width = f.width;
    height = f.height;
    frames.push({ bitmap: f.bitmap, delayMs: f.delayMs });
  }
  return { width, height, frames };
}

export interface GifToVideoOptions {
  container?: 'mp4' | 'webm' | 'mov' | 'mkv';
  codec?: VideoCodec;
  quality?: QualityLevel;
  /** play the GIF this many times in the video (short GIFs make very short videos) */
  repeat?: number;
  /** fills transparent pixels */
  background?: string;
  /** scale to this width (even); default keeps the GIF size */
  width?: number;
}

export async function gifToVideo(file: Blob, o: GifToVideoOptions = {}, ctl: JobControl = {}): Promise<TranscodeResult> {
  const container = o.container ?? 'mp4';
  const c = containers[container];
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!isGif(bytes)) throw new MediaError('unsupported-input', 'This is not a GIF file.');
  const header = parseGif(new Uint8Array(await file.arrayBuffer()));
  const scale = o.width ? o.width / header.width : 1;
  const W = evenize(header.width * scale);
  const H = evenize(header.height * scale);
  const repeat = Math.max(1, Math.floor(o.repeat ?? 1));
  const canvas = createCanvas(W, H);
  const ctx = context2d(canvas);
  const output = new Output({ format: outputFormat(container), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: await pickVideoCodec(container, o.codec, W, H), quality: new Quality(o.quality ?? 'high') });
  output.addVideoTrack(source);
  let t = 0;
  try {
    await output.start();
    for (let r = 0; r < repeat; r++) {
      let i = 0;
      for await (const f of gifFrames(file, ctl.signal)) {
        ctx.fillStyle = o.background ?? '#000';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(f.bitmap, 0, 0, W, H);
        f.bitmap.close();
        await source.add(t, f.delayMs / 1000);
        t += f.delayMs / 1000;
        ctl.onProgress?.((r + ++i / header.frames.length) / repeat);
      }
    }
    source.close();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw toMediaError(e);
  }
  return {
    blob: new Blob([(output.target as BufferTarget).buffer!], { type: c.mime }),
    container,
    mimeWithCodecs: await output.getMimeType().catch(() => c.mime),
    width: W,
    height: H,
    durationSec: t,
    notes: [],
    via: 'mediabunny',
  };
}

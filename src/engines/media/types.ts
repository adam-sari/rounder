export type VideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8';
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'flac' | 'vorbis' | 'pcm-s16' | 'pcm-s24' | 'pcm-f32';
export type Container = 'mp4' | 'mov' | 'webm' | 'mkv' | 'mp3' | 'wav' | 'ogg' | 'm4a' | 'flac';
export type QualityLevel = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';
export type Fit = 'contain' | 'cover' | 'fill';
export type Rotation = 0 | 90 | 180 | 270;

export interface ContainerInfo {
  label: string;
  ext: string;
  mime: string;
  /** codecs this container can hold, best default first */
  video: VideoCodec[];
  audio: AudioCodec[];
}

export const containers: Record<Container, ContainerInfo> = {
  mp4: { label: 'MP4', ext: 'mp4', mime: 'video/mp4', video: ['avc', 'hevc', 'av1', 'vp9'], audio: ['aac', 'opus', 'mp3', 'flac'] },
  mov: { label: 'MOV', ext: 'mov', mime: 'video/quicktime', video: ['avc', 'hevc'], audio: ['aac', 'pcm-s16'] },
  webm: { label: 'WebM', ext: 'webm', mime: 'video/webm', video: ['vp9', 'av1', 'vp8'], audio: ['opus', 'vorbis'] },
  mkv: { label: 'MKV', ext: 'mkv', mime: 'video/x-matroska', video: ['avc', 'hevc', 'vp9', 'av1', 'vp8'], audio: ['opus', 'aac', 'flac', 'mp3', 'vorbis', 'pcm-s16'] },
  mp3: { label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', video: [], audio: ['mp3'] },
  wav: { label: 'WAV', ext: 'wav', mime: 'audio/wav', video: [], audio: ['pcm-s16', 'pcm-s24', 'pcm-f32'] },
  ogg: { label: 'OGG', ext: 'ogg', mime: 'audio/ogg', video: [], audio: ['opus', 'vorbis', 'flac'] },
  m4a: { label: 'M4A', ext: 'm4a', mime: 'audio/mp4', video: [], audio: ['aac'] },
  flac: { label: 'FLAC', ext: 'flac', mime: 'audio/flac', video: [], audio: ['flac'] },
};

export const videoCodecLabel: Record<VideoCodec, string> = { avc: 'H.264', hevc: 'H.265 / HEVC', vp9: 'VP9', av1: 'AV1', vp8: 'VP8' };
export const audioCodecLabel: Record<AudioCodec, string> = {
  aac: 'AAC', opus: 'Opus', mp3: 'MP3', flac: 'FLAC', vorbis: 'Vorbis', 'pcm-s16': 'PCM 16-bit', 'pcm-s24': 'PCM 24-bit', 'pcm-f32': 'PCM 32-bit float',
};

export const isAudioContainer = (c: Container) => containers[c].video.length === 0;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Segment {
  start: number;
  end: number;
}

export interface VideoInfo {
  /** mediabunny codec id ('avc', 'hevc', …) or the ffmpeg name for exotic codecs */
  codec: string | null;
  /** coded size, before rotation */
  width: number;
  height: number;
  /** what a player shows: pixel aspect ratio and rotation applied */
  displayWidth: number;
  displayHeight: number;
  rotation: Rotation;
  fps: number | null;
  bitrate: number | null;
  /** WebCodecs can decode it in this browser */
  canDecode: boolean;
}

export interface AudioInfo {
  codec: string | null;
  sampleRate: number;
  channels: number;
  bitrate: number | null;
  canDecode: boolean;
}

export interface MediaInfo {
  /** 'mp4' | 'mov' | 'webm' | 'mkv' | 'mp3' | 'wav' | 'ogg' | 'aac' | 'flac' | 'ts' | ffmpeg's name | 'unknown' */
  container: string;
  durationSec: number;
  sizeBytes: number;
  video?: VideoInfo;
  audio?: AudioInfo;
  /** mediabunny can open the container */
  readable: boolean;
  /** true when transcode/decode will go through the ffmpeg.wasm fallback (a ~31 MB download) */
  needsFallback: boolean;
  /** which engine produced this info */
  via: 'mediabunny' | 'ffmpeg';
}

export interface Capabilities {
  webCodecs: { videoEncoder: boolean; videoDecoder: boolean; audioEncoder: boolean; audioDecoder: boolean };
  video: { encode: VideoCodec[]; decode: VideoCodec[] };
  /** encode includes software fallbacks: mp3 (LAME) and aac (when the browser has no native encoder) */
  audio: { encode: AudioCodec[]; decode: AudioCodec[]; nativeAac: boolean };
  /** containers we can write with at least one encodable codec */
  containers: Record<Container, boolean>;
  imageDecoder: boolean;
}

export interface VideoOptions {
  /** preferred codec; falls back down the container's list when this browser can't encode it */
  codec?: VideoCodec;
  /** output size; give one side to keep the aspect ratio, or both plus `fit` */
  width?: number;
  height?: number;
  /** contain = letterbox, cover = crop to fill, fill = stretch (default contain when both sides are set) */
  fit?: Fit;
  /** 0–1 multiplier of the (cropped) source size, used when width/height are absent */
  scale?: number;
  /** region to keep, in display pixels after rotate/flip */
  crop?: Rect;
  /** clockwise, baked into the pixels (not just metadata) */
  rotate?: Rotation;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  /** frame-rate cap */
  fps?: number;
  /** pick one: bitrate (bits/s) > targetSizeBytes > quality */
  bitrate?: number;
  /** aim for this whole-file size; the bitrate is derived from the output duration */
  targetSizeBytes?: number;
  quality?: QualityLevel;
  /** 0.25–4; frames are re-timed (and dropped down to `fps` when sped up) */
  speed?: number;
  keyFrameInterval?: number;
  /**
   * Draw on top of each finished frame (subtitles, watermarks). The canvas is already the
   * output size and holds the frame. Hooks force the job onto the main thread.
   */
  overlay?: (ctx: Ctx2D, frame: FrameInfo) => void | Promise<void>;
  /**
   * Full control: you draw the frame yourself (auto-reframe, background removal). `source` is
   * the decoded frame after rotate/flip/crop but before resizing; draw it with
   * `source.draw(ctx, x, y, w, h)` or `source.drawWithFit(ctx, { fit: 'cover' })`.
   */
  render?: (ctx: Ctx2D, source: import('mediabunny').VideoSample, frame: FrameInfo) => void | Promise<void>;
}

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface FrameInfo {
  /** output timestamp in seconds */
  time: number;
  index: number;
  width: number;
  height: number;
}

export interface AudioOptions {
  codec?: AudioCodec;
  bitrate?: number;
  quality?: QualityLevel;
  sampleRate?: number;
  channels?: number;
  gainDb?: number;
  /** use this file's audio instead of the input's (cut to the video length) */
  replace?: Blob;
  /** where to start reading `replace`, in seconds */
  replaceOffset?: number;
}

export interface TranscodeOptions {
  container: Container;
  trim?: { start?: number; end?: number };
  /** false drops the video track */
  video?: VideoOptions | false;
  /** false drops (mutes) the audio track */
  audio?: AudioOptions | false;
  /** copy title/artist/cover tags (default true) */
  keepMetadata?: boolean;
}

export interface JobControl {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface TranscodeControl extends JobControl {
  /** 'ffmpeg' forces the wasm fallback (for testing, or browsers without WebCodecs) */
  engine?: 'auto' | 'ffmpeg';
}

export interface TranscodeResult {
  blob: Blob;
  container: Container;
  /** e.g. video/mp4; codecs="avc1.64001f, mp4a.40.2" */
  mimeWithCodecs: string;
  width?: number;
  height?: number;
  durationSec: number;
  /** human-readable notes about fallbacks the engine took */
  notes: string[];
  via: 'mediabunny' | 'ffmpeg';
}

/** decoded audio: one Float32Array per channel, -1…1 */
export interface Pcm {
  sampleRate: number;
  channels: Float32Array[];
}

/** per-bucket min/max (-1…1) and rms (0…1), for drawing waveforms */
export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  rms: Float32Array;
}

export interface Frame {
  time: number;
  bitmap: ImageBitmap;
}

export type MediaErrorCode =
  | 'unsupported-input'
  | 'unsupported-codec'
  | 'no-webcodecs'
  | 'no-tracks'
  | 'invalid-options'
  | 'aborted'
  | 'out-of-memory'
  | 'ffmpeg-failed'
  | 'failed';

/** Every engine failure is a MediaError; `code` is stable, `message` is safe to show users */
export class MediaError extends Error {
  readonly code: MediaErrorCode;
  constructor(code: MediaErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MediaError';
    this.code = code;
  }
}

export const isAbort = (e: unknown) => e instanceof MediaError && e.code === 'aborted';

const OOM = /out of memory|allocation failed|array buffer allocation|memory access out of bounds|quotaexceeded|cannot allocate/i;

/** maps anything thrown (including errors that crossed a worker boundary) to a MediaError */
export function toMediaError(e: unknown): MediaError {
  if (e instanceof MediaError) return e;
  const err = e as { name?: string; message?: string; code?: unknown } | undefined;
  const message = err?.message ?? String(e);
  if (err?.name === 'MediaError' && typeof err.code === 'string') return new MediaError(err.code as MediaErrorCode, message);
  if (err?.name === 'AbortError' || err?.name === 'ConversionCanceledError' || /cancel+ed|aborted/i.test(message)) {
    return new MediaError('aborted', 'Cancelled.', { cause: e });
  }
  if (err?.name === 'UnsupportedInputFormatError') return new MediaError('unsupported-input', "This file's format isn't supported.", { cause: e });
  if (e instanceof RangeError || OOM.test(message) || err?.name === 'QuotaExceededError') {
    return new MediaError('out-of-memory', 'Ran out of memory. Try a shorter clip or a smaller output size.', { cause: e });
  }
  return new MediaError('failed', message || 'Something went wrong while processing the file.', { cause: e });
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new MediaError('aborted', 'Cancelled.');
}

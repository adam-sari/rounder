import { clamp, invertSegments, normalizeSegments } from '@/engines/media/math';
import { containers, type Container, type MediaErrorCode, type MediaInfo, type QualityLevel, type Segment, type VideoCodec } from '@/engines/media/types';

export const VIDEO_CONTAINERS = ['mp4', 'mov', 'webm', 'mkv'] as const satisfies readonly Container[];
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number];

/** 'copy' keeps the original streams; the rest re-encode at that quality */
export type Preset = 'copy' | Extract<QualityLevel, 'very-high' | 'high' | 'medium'>;

/** the source's own container when we can write it, else MP4 (or whatever this browser can write) */
export function defaultContainer(source: string, writable: Partial<Record<Container, boolean>> | null): VideoContainer {
  const ok = (c: VideoContainer) => !writable || !!writable[c];
  const same = VIDEO_CONTAINERS.find((c) => c === source);
  if (same && ok(same)) return same;
  return ok('mp4') ? 'mp4' : (VIDEO_CONTAINERS.find(ok) ?? 'mp4');
}

/**
 * the parts that end up in the output: the trim range, or everything except the cuts. Slivers
 * left between cuts that are shorter than minPart (pass about half a frame) hold no frame, so
 * they are dropped instead of becoming empty pieces to encode.
 */
export function keptParts(mode: 'trim' | 'segments', start: number, end: number, cuts: Segment[], duration: number, minPart = 0.01): Segment[] {
  if (mode === 'trim') return normalizeSegments([{ start, end }], duration);
  return invertSegments(cuts, duration, minPart);
}

/**
 * Why "no re-encode" can't keep the original video stream here, or '' when it can. A codec the
 * container can't hold, or a rotated (phone) video, makes the engine re-encode it anyway.
 */
export function copyBlocker(codec: string | null, rotation: number, container: VideoContainer): string {
  const c = containers[container];
  if (!codec || !(c.video as string[]).includes(codec)) return `${c.label} can't hold this video's codec without re-encoding`;
  if (rotation) return 'this video is stored rotated (common for phone clips), so it has to be re-encoded to stay upright';
  return '';
}

// ---------------------------------------------------------------- frames

/** a hair past a frame's start so float rounding never shows the previous frame */
const NUDGE = 0.02;

/** index of the frame on screen at time t */
export const frameIndex = (t: number, fps: number) => Math.floor(t * fps + NUDGE);

/** seek target that lands on frame n */
export const frameTime = (n: number, fps: number) => (Math.max(0, n) + NUDGE) / fps;

/** one frame forward or back from t (dir = ±1), clamped to the clip */
export function stepFrame(t: number, fps: number, dir: number, duration: number): number {
  const last = Math.max(0, Math.ceil(duration * fps) - 1);
  return Math.min(frameTime(clamp(frameIndex(t, fps) + dir, 0, last), fps), duration);
}

/** an in point starts with the frame on screen… */
export const inPoint = (t: number, fps: number) => frameIndex(t, fps) / fps;

/** …and an out point keeps it */
export const outPoint = (t: number, fps: number, duration: number) => Math.min(duration, (frameIndex(t, fps) + 1) / fps);

/** "I" in trim mode; an in point past the out point reopens the end */
export function markTrimIn(range: Segment, t: number, duration: number, minLength: number): Segment {
  const start = clamp(t, 0, Math.max(0, duration - minLength));
  return { start, end: range.end - start < minLength ? duration : range.end };
}

/** "O" in trim mode; an out point before the in point reopens the start */
export function markTrimOut(range: Segment, t: number, duration: number, minLength: number): Segment {
  const end = clamp(t, Math.min(minLength, duration), duration);
  return { start: end - range.start < minLength ? 0 : range.start, end };
}

/**
 * "I" / "O" while cutting out parts: moves the edge of the cut under the playhead, or of the
 * nearest cut on the right (in) / left (out). With nothing to move, starts a new 1 s cut there.
 */
export function markCut(cuts: Segment[], t: number, edge: 'start' | 'end', duration: number, minLength: number): Segment[] {
  const list = normalizeSegments(cuts, duration, 0);
  const inside = list.findIndex((c) => t >= c.start && t < c.end);
  const i = inside >= 0 ? inside : edge === 'start' ? list.findIndex((c) => c.start > t) : list.findLastIndex((c) => c.end <= t);
  if (i < 0) {
    const prevEnd = list.findLast((c) => c.end <= t)?.end ?? 0;
    const nextStart = list.find((c) => c.start > t)?.start ?? duration;
    const cut = edge === 'start' ? { start: t, end: Math.min(nextStart, t + 1) } : { start: Math.max(prevEnd, t - 1), end: t };
    return cut.end - cut.start >= minLength ? normalizeSegments([...list, cut], duration, 0) : list;
  }
  const c = list[i];
  const lo = list[i - 1]?.end ?? 0;
  const hi = list[i + 1]?.start ?? duration;
  const next = edge === 'start' ? { start: clamp(t, lo, c.end - minLength), end: c.end } : { start: c.start, end: clamp(t, c.start + minLength, hi) };
  if (next.end - next.start < minLength) return list;
  return list.map((x, j) => (j === i ? next : x));
}

/** during "preview without cuts": where to jump when the playhead is inside a cut, else null */
export function skipTarget(cuts: Segment[], t: number): number | null {
  const c = cuts.find((x) => t >= x.start && t < x.end - 0.01);
  return c ? c.end : null;
}

// ---------------------------------------------------------------- quality

// mirrors mediabunny's Quality → bitrate estimate, so a re-encode never balloons a lean source
const efficiency: Record<string, number> = { avc: 1, hevc: 0.6, vp9: 0.6, av1: 0.4, vp8: 1.2 };
const levelValue: Record<QualityLevel, number> = { 'very-low': 0, low: 0.25, medium: 0.5, high: 0.75, 'very-high': 1 };

export function estimateVideoBitrate(codec: VideoCodec, width: number, height: number, level: QualityLevel): number {
  const base = 3_000_000 * Math.pow((width * height) / (1920 * 1080), 0.95);
  return Math.ceil((base * (efficiency[codec] ?? 1) * 0.3 * Math.exp(2.5538 * levelValue[level])) / 1000) * 1000;
}

/** the first codec this container takes that the browser can encode (what the engine will pick) */
export function likelyCodec(container: Container, encodable: VideoCodec[] | null): VideoCodec {
  const list = containers[container].video;
  return list.find((c) => !encodable || encodable.includes(c)) ?? list[0];
}

export interface SourceVideo {
  codec: string | null;
  width: number;
  height: number;
  bitrate: number | null;
}

/**
 * The source video's average bitrate, for Best to follow: the file's own average less the audio's.
 * The track's figure is often an estimate from its first 240 packets (few MP4s store one), which a
 * calm or busy opening throws off many times over (17 kbps for a 163 Mbps clip with a still intro);
 * the whole file's average can't be, and following it keeps a cut about the size of that slice.
 */
export function sourceVideoBitrate(info: Pick<MediaInfo, 'sizeBytes' | 'durationSec' | 'video' | 'audio'>): number | null {
  const whole = info.durationSec > 0 ? (info.sizeBytes * 8) / info.durationSec - (info.audio?.bitrate ?? 0) : 0;
  return whole > 0 ? Math.round(whole) : (info.video?.bitrate ?? null);
}

/**
 * The codec a re-encode writes. Best keeps the source's own codec when the container holds it and
 * this browser can encode it, so following the source's bitrate keeps the size too (an HEVC phone
 * clip needs about 1.7× the bitrate in H.264 to look the same). Otherwise the engine's pick.
 */
export function outputCodec(preset: Preset, srcCodec: string | null, container: Container, encodable: VideoCodec[] | null): VideoCodec {
  const own = srcCodec as VideoCodec;
  if (preset === 'very-high' && encodable?.includes(own) && containers[container].video.includes(own)) return own;
  return likelyCodec(container, encodable);
}

/** the most High and Smaller spend relative to Best, so they always come out lighter than it */
const SHARE = { high: 0.7, medium: 0.45 };

/**
 * Video options for a preset: null = copy the stream, otherwise always an explicit bitrate. A bare
 * quality level makes mediabunny encode at a constant quantizer for H.264/HEVC/VP9/AV1, whose size
 * has no bound (Best turned a 16 Mbps 1080p clip into 42 Mbps), so the level is never passed on.
 * Best follows the source's own bitrate (scaled for a codec change), so the cut comes out about the
 * size of that part of the original, like the converter's "original". High and Smaller take the
 * level's estimate for the resolution, capped at a share of that. An unknown source bitrate falls
 * back to the estimates.
 */
export function videoQuality(preset: Preset, src: SourceVideo, outCodec: VideoCodec): null | { bitrate: number } {
  if (preset === 'copy') return null;
  const level = estimateVideoBitrate(outCodec, src.width, src.height, preset);
  if (!src.bitrate) return { bitrate: level };
  const follow = Math.round((src.bitrate * (efficiency[outCodec] ?? 1)) / (efficiency[src.codec ?? ''] ?? 1));
  return { bitrate: preset === 'very-high' ? follow : Math.min(level, Math.round(follow * SHARE[preset])) };
}

/**
 * What an export really does with the chosen preset. A copy has to begin on a keyframe, and the
 * first frame always is one, so Best copies the streams untouched (lossless, original size) when
 * the one kept part starts there and the stream can be copied; the end of a copy is cut on the
 * frame. "No re-encode" falls back to Best when the stream can't be copied (`copyBlock`).
 */
export function exportPreset(preset: Preset, parts: Segment[], copyBlock: string, fps: number): Preset {
  if (copyBlock) return preset === 'copy' ? 'very-high' : preset;
  return preset === 'very-high' && parts.length === 1 && parts[0].start < 0.5 / fps ? 'copy' : preset;
}

// ---------------------------------------------------------------- progress & errors

/** seconds left, once there is enough progress to guess */
export function etaSeconds(elapsedMs: number, progress: number): number | null {
  if (progress < 0.03 || elapsedMs < 1500) return null;
  return Math.max(0, (elapsedMs / 1000) * ((1 - progress) / progress));
}

export function friendlyError(code: MediaErrorCode | undefined, message: string): string {
  switch (code) {
    case 'unsupported-input':
      return "This file can't be read. It may be damaged, or use a format browsers can't open.";
    case 'unsupported-codec':
      return "Your browser can't write that format. Pick another output format (MP4 works almost everywhere).";
    case 'no-webcodecs':
      return 'This browser is missing video encoding support (WebCodecs). Try a recent Chrome, Edge, Safari or Firefox.';
    case 'no-tracks':
      return "This file has no video track to trim. For audio, try the audio cutter.";
    case 'out-of-memory':
      return 'Your device ran out of memory. Try a shorter selection, or close other tabs and try again.';
    case 'ffmpeg-failed':
      return "The fallback decoder couldn't convert this file. It may be damaged or use an unusual codec.";
    case 'invalid-options':
      return message || 'Those settings won\'t work for this file.';
    default:
      return message || 'Something went wrong while processing the video.';
  }
}

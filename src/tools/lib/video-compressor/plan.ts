import { bitrateForTargetSize, estimateSizeBytes, evenize, planVideoSize, snapAudioBitrate } from '@/engines/media/math';
import type { MediaErrorCode, MediaInfo, TranscodeOptions, VideoOptions } from '@/engines/media/types';

export type Mode = 'target' | 'quality';
export type Preset = 'high' | 'balanced' | 'small';
/** short-side cap in pixels; 'auto' picks one from the target-size budget */
export type Resolution = 'auto' | 'original' | 1080 | 720 | 480;
export type FpsCap = 'original' | 30 | 24;
export type CodecChoice = 'avc' | 'hevc' | 'av1' | 'vp9';

export interface Settings {
  mode: Mode;
  /** decimal megabytes, as file managers and upload limits count them */
  targetMB: number;
  preset: Preset;
  resolution: Resolution;
  fps: FpsCap;
  codec: CodecChoice;
  removeAudio: boolean;
}

export const MB = 1_000_000;

export const targetPresets: { mb: number; label: string }[] = [
  { mb: 10, label: 'Discord' },
  { mb: 20, label: 'Email' },
  { mb: 50, label: 'Nitro Basic' },
];

/** VP9 lives in WebM; the rest go in MP4, which plays almost everywhere */
export const containerFor = (codec: CodecChoice) => (codec === 'vp9' ? 'webm' : 'mp4');

// bits mediabunny's own size model gives each codec relative to H.264 at equal quality
const efficiency: Record<CodecChoice, number> = { avc: 1, hevc: 0.6, vp9: 0.6, av1: 0.4 };

// mediabunny's quality scale (0 = very-low … 1 = very-high) for each preset, and how far
// below the source's own bitrate each preset is allowed to go
const presetLevel: Record<Preset, { q: number; ofSource: number; aac: number; opus: number }> = {
  high: { q: 0.5, ofSource: 0.75, aac: 160_000, opus: 128_000 },
  balanced: { q: 0.25, ofSource: 0.5, aac: 128_000, opus: 96_000 },
  small: { q: 0, ofSource: 0.3, aac: 96_000, opus: 64_000 },
};

/** mediabunny's bitrate model for a quality level (encode.js computeVideoBitrate) */
export function qualityBitrate(codec: CodecChoice, width: number, height: number, q: number) {
  const base = 3_000_000 * Math.pow((width * height) / (1920 * 1080), 0.95);
  return Math.ceil((base * efficiency[codec] * 0.3 * Math.exp(2.5538 * q)) / 1000) * 1000;
}

/** Scales w × h so the short side is at most `shortSide`; never upscales */
export function capSize(w: number, h: number, shortSide?: number) {
  const s = Math.min(w, h);
  if (!shortSide || s <= shortSide) return { width: evenize(w), height: evenize(h) };
  const k = shortSide / s;
  return { width: evenize(w * k), height: evenize(h * k) };
}

// below this many bits per pixel per frame, H.264 turns to mush; a smaller frame looks better
const MIN_BPP = 0.04;
const autoSteps = [1080, 720, 540, 480, 360];

/** the largest short side (or undefined = keep) the bitrate can fill without falling apart */
export function autoShortSide(w: number, h: number, fps: number, videoBitrate: number, codec: CodecChoice): number | undefined {
  const s = Math.min(w, h);
  const enough = (side: number) => {
    const { width, height } = capSize(w, h, side);
    return videoBitrate / (width * height * fps) >= MIN_BPP * efficiency[codec];
  };
  if (enough(s)) return undefined;
  const steps = autoSteps.filter((x) => x < s);
  return steps.find(enough) ?? steps[steps.length - 1];
}

export interface Plan {
  options: TranscodeOptions;
  container: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number | null;
  /** the short side picked by 'auto', for the UI */
  autoSide?: number;
  videoBitrate: number;
  audioBitrate: number;
  estimateBytes: number;
  /** false when the target is too small for this length even at the lowest bitrate */
  feasible: boolean;
  /** set when the file already fits the target and is kept as is */
  skip?: 'fits';
}

/** turns a probed file and the user's settings into transcode options plus an estimate */
export function planCompression(info: MediaInfo, s: Settings): Plan {
  const v = info.video;
  if (!v) throw new Error('no video track');
  const duration = Math.max(info.durationSec, 0.1);
  const container = containerFor(s.codec);
  const keepAudio = !!info.audio && !s.removeAudio;
  const srcAudio = info.audio?.bitrate ?? 128_000;
  const srcFps = v.fps ?? 30;
  // an unknown source rate still gets the cap: the engine only ever lowers the frame rate
  const fpsCap = s.fps !== 'original' && (!v.fps || s.fps < v.fps - 0.01) ? s.fps : undefined;
  const fps = fpsCap ?? v.fps;
  const snap = (b: number) => snapAudioBitrate(container === 'webm' ? 'opus' : 'aac', b) ?? b;
  const srcVideo = v.bitrate ?? Math.max(100_000, (info.sizeBytes * 8) / duration - (info.audio ? srcAudio : 0));

  let videoBitrate: number;
  let audioBitrate = 0;
  let feasible = true;
  let shortSide: number | undefined = typeof s.resolution === 'number' ? s.resolution : undefined;
  let autoSide: number | undefined;
  const video: VideoOptions = { codec: s.codec };
  let audio: TranscodeOptions['audio'] = keepAudio ? undefined : false;

  const limit = s.targetMB * MB;
  const fits = info.sizeBytes <= limit;
  // changes only a re-encode can make, so a file that already fits isn't simply handed back
  const asked = (s.removeAudio && !!info.audio) || (typeof s.resolution === 'number' && s.resolution < Math.min(v.displayWidth, v.displayHeight)) || !!fpsCap;

  if (s.mode === 'target') {
    // a file under the limit keeps its own size as the budget rather than growing to fill it
    const target = Math.min(limit, info.sizeBytes);
    const split = bitrateForTargetSize(target, duration, { audioBitrate: keepAudio ? Math.min(128_000, srcAudio) : 0, snapAudio: snap });
    videoBitrate = split.videoBitrate;
    audioBitrate = split.audioBitrate;
    feasible = split.feasible;
    if (s.resolution === 'auto') shortSide = autoSide = autoShortSide(v.displayWidth, v.displayHeight, fps ?? 30, videoBitrate, s.codec);
    video.targetSizeBytes = target;
    if (keepAudio) audio = { bitrate: audioBitrate };
  } else {
    const p = presetLevel[s.preset];
    const out = capSize(v.displayWidth, v.displayHeight, shortSide);
    const pixelShare = Math.pow((out.width * out.height) / (v.displayWidth * v.displayHeight), 0.95);
    const fpsShare = fpsCap ? fpsCap / srcFps : 1;
    // whichever is lower: the preset's quality, or a fixed share of what the source already spends
    videoBitrate = Math.max(80_000, Math.min(qualityBitrate(s.codec, out.width, out.height, p.q), srcVideo * p.ofSource * pixelShare * fpsShare));
    video.bitrate = videoBitrate;
    if (keepAudio) {
      const want = snap(container === 'webm' ? p.opus : p.aac);
      // copy the source's audio untouched when it's already lean and fits the container
      const copyable = srcAudio <= want && (container === 'webm' ? ['opus', 'vorbis'] : ['aac', 'mp3']).includes(info.audio!.codec ?? '');
      audioBitrate = copyable ? srcAudio : want;
      if (!copyable) audio = { bitrate: want };
    }
  }

  const landscape = v.displayWidth >= v.displayHeight;
  if (shortSide && shortSide < Math.min(v.displayWidth, v.displayHeight)) {
    if (landscape) video.height = shortSide;
    else video.width = shortSide;
  }
  if (fpsCap) video.fps = fpsCap;
  const { width, height } = planVideoSize(v.displayWidth, v.displayHeight, video);

  const plan: Plan = {
    options: { container, video, audio },
    container,
    width,
    height,
    fps,
    autoSide,
    videoBitrate,
    audioBitrate,
    estimateBytes: estimateSizeBytes(duration, videoBitrate, audioBitrate),
    feasible,
  };
  if (s.mode === 'target' && fits && !asked) plan.skip = 'fits';
  return plan;
}

export const codecInfo: Record<CodecChoice, { label: string; note: string }> = {
  avc: { label: 'H.264 · MP4', note: 'Plays everywhere: phones, TVs, Discord, editors.' },
  hevc: { label: 'HEVC · MP4', note: 'Smaller at the same quality. Great on Apple devices; some browsers and older PCs can’t play it.' },
  av1: { label: 'AV1 · MP4', note: 'Smallest files, slowest to encode. Modern browsers play it; older phones and TVs may not.' },
  vp9: { label: 'VP9 · WebM', note: 'Smaller than H.264. Plays in browsers and on Android; not every Apple app opens WebM.' },
};

/** a human ETA once there's enough progress to guess from; null until then */
export function etaSeconds(elapsedMs: number, progress: number): number | null {
  if (progress < 0.03 || elapsedMs < 1500) return null;
  return Math.max(0, (elapsedMs / 1000) * ((1 - progress) / progress));
}

/** "1:05" / "12s" for elapsed and remaining time */
export function shortDuration(sec: number) {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

const friendly: Partial<Record<MediaErrorCode, string>> = {
  'unsupported-input': "This file's format can't be read in the browser.",
  'unsupported-codec': "Your browser can't encode that codec. Pick H.264 and try again.",
  'no-webcodecs': 'Your browser is missing the video features this tool needs. Try a recent Chrome, Edge, Safari or Firefox.',
  'no-tracks': 'This file has no video to compress.',
  'out-of-memory': 'Your browser ran out of memory. Try a lower resolution, or close other tabs and try again.',
  'ffmpeg-failed': "The fallback decoder couldn't convert this file.",
};

/** a short message for each engine error code; falls back to the engine's own wording */
export function errorText(code: string | undefined, message: string | undefined) {
  return friendly[code as MediaErrorCode] ?? message ?? 'Something went wrong while compressing this video.';
}

/**
 * The size to aim for on another try after a result came out over the target: the last aim shrunk by how far it
 * overshot, with 3% spare. Encoders overshoot most on short clips and on ones with a lot of motion or grain.
 */
export function retryAimMB(targetMB: number, aimedMB: number, gotBytes: number) {
  return Math.max(0.1, Math.floor(aimedMB * ((targetMB * MB) / gotBytes) * 0.97 * 100) / 100);
}

/** why a target-size result came out over the limit, in a sentence */
export function overReason(plan: Plan, durationSec: number, targetMB: number) {
  if (!plan.feasible) return `${targetMB} MB leaves too little room for ${shortDuration(durationSec)} of video, even with the audio squeezed. Trim the clip or pick a bigger target.`;
  if (plan.audioBitrate && plan.audioBitrate > plan.videoBitrate / 2) return 'The sound takes a big share of the budget. Removing the audio, or trimming the clip, leaves more room for the picture.';
  return 'The encoder spent a little more than planned, which happens with lots of motion or grain. Another try aims lower to make up for it.';
}

// Low-end device safety for the heavy tools. Before a run, checkDevice() compares a rough peak-memory estimate for
// the job with what this device can give one tab (navigator.deviceMemory, Chromium only) and with hard browser
// limits (canvas size, ffmpeg.wasm's 2 GB heap). It answers ok, warn (run it, but say it may fail and what's lighter)
// or block (it can't work here, so say why and what to try). It only blocks on a hard limit or when the device
// reports its memory and the job needs far more than that; browsers that don't report memory get warnings at most.
// When a run still runs out of memory, deviceMessage() turns the error into the same kind of friendly advice.

export type GuardLevel = 'ok' | 'warn' | 'block';

export interface Verdict {
  level: GuardLevel;
  /** '' when ok; written for people, safe to show as-is */
  message: string;
}

export interface DeviceSpec {
  /** RAM in GB from navigator.deviceMemory: Chromium only, rounded to a power of two and capped at 8 */
  memoryGB?: number;
  cores: number;
  mobile: boolean;
  /** iPhone or iPad: Safari there caps a canvas at 16.7 megapixels */
  ios: boolean;
}

/**
 * What the heavy work is, which decides the memory model and the advice:
 * video = WebCodecs transcode (compress, convert, trim), ffmpeg = the ffmpeg.wasm fallback,
 * image-ai = background/object remover and colorizer, images = many photos into one file (images to PDF).
 */
export type Job = 'video' | 'ffmpeg' | 'gif' | 'merge' | 'slideshow' | 'collage' | 'image-ai' | 'upscale' | 'image' | 'images' | 'transcribe' | 'vocals' | 'pdf' | 'ocr';

export interface Load {
  /** total input size */
  bytes?: number;
  /** expected output size, when it's known to differ from the input (ffmpeg holds its output in its heap) */
  outBytes?: number;
  /** media length in seconds, after trimming */
  seconds?: number;
  /** the frame or picture size the job works at (the output size for upscale, collage and image; the largest photo for images) */
  width?: number;
  height?: number;
  /** GIF frames, photos, clips or pages */
  count?: number;
  /** replaces the job's default "try …" advice */
  tip?: string;
}

const MB = 2 ** 20;
const GB = 2 ** 30;
/** ffmpeg.wasm (@ffmpeg/core 0.12) can't grow its heap past 2 GB */
export const FFMPEG_HEAP = 2 * GB;
/** largest canvas area: iOS Safari, then every other current browser (Chrome, Firefox, desktop Safari) */
export const CANVAS_AREA = { ios: 4096 * 4096, other: 16384 * 16384 };
export const CANVAS_SIDE = 32767;

const NOUN: Record<Job, string> = {
  video: 'video',
  ffmpeg: 'file',
  gif: 'GIF',
  merge: 'set of clips',
  slideshow: 'slideshow',
  collage: 'collage',
  'image-ai': 'photo',
  upscale: 'upscaled image',
  image: 'image',
  images: 'set of images',
  transcribe: 'recording',
  vocals: 'song',
  pdf: 'PDF',
  ocr: 'PDF',
};

const TIPS: Record<Job, string> = {
  video: 'Try 720p or 480p, or trim it into shorter parts first.',
  ffmpeg: 'Try trimming it into shorter parts, or convert it on a computer with more memory.',
  gif: 'Try a smaller width, a lower frame rate or a shorter range.',
  merge: 'Try 720p, or merge fewer clips at a time.',
  slideshow: 'Try 720p, or fewer photos.',
  collage: 'Try a smaller output size.',
  'image-ai': 'Try a smaller copy of the photo (about 2000 pixels wide is plenty).',
  upscale: 'Try 2× instead of 4×, or crop the image first.',
  image: 'Try a smaller output size.',
  images: 'Try fewer images at a time, or turn on Compress images.',
  transcribe: 'Try cutting it into shorter parts, or the smaller model.',
  vocals: 'Try cutting the song into shorter parts with the audio cutter.',
  pdf: 'Try splitting the PDF into smaller parts first.',
  ocr: 'Try fewer pages at a time, or split the PDF first.',
};

/** what this device says about itself; a desktop guess when there is no navigator (SSR, tests) */
export function deviceSpec(): DeviceSpec {
  if (typeof navigator === 'undefined') return { cores: 4, mobile: false, ios: false };
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile: boolean } };
  // iPadOS reports itself as a Mac; touch points give it away
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  const mobile = nav.userAgentData?.mobile ?? (ios || /Android|Mobile/i.test(nav.userAgent));
  return { memoryGB: nav.deviceMemory || undefined, cores: nav.hardwareConcurrency || 2, mobile, ios };
}

/**
 * Memory one tab can use before the browser kills it or allocations fail: about a third of RAM on phones (the OS,
 * the browser and other apps keep the rest) and 40% on computers. Without deviceMemory: a typical phone or iPhone
 * tab (about 1 GB) or a typical computer (3 GB), and `known` is false so nothing is blocked on a guess.
 */
export function memoryBudget(d: DeviceSpec): { bytes: number; known: boolean } {
  if (d.memoryGB) return { bytes: Math.min(d.memoryGB * (d.mobile ? 0.3 : 0.4), 4) * GB, known: true };
  return { bytes: (d.mobile ? 1 : 3) * GB, known: false };
}

const px = (l: Load) => Math.max(0, (l.width ?? 0) * (l.height ?? 0));
/** frames a WebCodecs pipeline keeps in flight (decoder queue, canvas, encoder queue), at 4 bytes a pixel; 1080p when the size isn't known, none for sound only (width 0) */
const frames = (l: Load, n = 16) => n * 4 * (l.width === undefined ? 1920 * 1080 : px(l));
/** outputs over 256 MB stream to disk (OPFS), smaller ones sit in memory */
const output = (bytes = 0) => Math.min(bytes, 256 * MB);

/** rough peak memory of a job, in bytes; deliberately simple, the thresholds below leave room for error */
export function estimateMemory(job: Job, l: Load): number {
  const bytes = l.bytes ?? 0;
  const seconds = l.seconds ?? 0;
  const count = l.count ?? 1;
  switch (job) {
    case 'video':
      return frames(l) + output(l.outBytes ?? bytes);
    case 'ffmpeg':
      // inputs are mounted without a copy; the output sits in the wasm heap and is copied out once
      return 2 * (l.outBytes ?? bytes) + 200 * MB;
    case 'gif':
      // the GIF grows in one buffer (doubling, so up to 3× its size while it copies), plus a batch of frames in flight;
      // without an estimate, a GIF takes about half a byte per pixel per frame
      return 3 * (l.outBytes ?? count * px(l) * 0.5) + 16 * px(l) * 4;
    case 'merge':
      return frames(l) + 2 * output(l.outBytes ?? bytes);
    case 'slideshow':
      // each photo's 800 px working copy and its full-size JPEG frame, plus the encode
      return frames(l) + count * (800 * 600 * 4 + px(l) * 0.3) + output(l.outBytes ?? bytes);
    case 'collage':
      // the full-size canvas, the pixels read back from it and the encoder's copy, plus each photo's working copy
      return px(l) * 4 * 3 + count * 1600 * 1200 * 4;
    case 'image':
      // the decoded source, the resized pixels and the encoder's copy (wasm codecs, no canvas)
      return px(l) * 4 * 3 + (l.bytes ?? 0) * 10;
    case 'image-ai':
      // the model and its runtime, plus a handful of full-size RGBA copies (source, mask, cut-out, preview)
      return 400 * MB + px(l) * 4 * 5;
    case 'upscale':
      // width and height are the output's: tiles are small, the stitched result and the PNG encoder are not
      return 300 * MB + px(l) * 4 * 3;
    case 'images':
      // every embedded image stays in the PDF builder until it saves (then twice), plus the largest one decoded
      return 3 * (l.outBytes ?? bytes) + px(l) * 4 * 2 + 100 * MB;
    case 'transcribe':
      // 16 kHz mono float samples for the whole file, a 5-minute decode window and the model with its runtime
      // (phones get the tiny or base model, about 40–80 MB of weights)
      return seconds * 16_000 * 4 + 300 * 48_000 * 4 + 300 * MB;
    case 'vocals':
      // the stereo song, four stereo stems and the model's working memory
      return seconds * 44_100 * 2 * 4 * 5 + 400 * MB;
    case 'pdf':
      // parsed objects and the saved copy run to a few times the file size
      return bytes * 4 + 100 * MB;
    case 'ocr':
      return bytes * 3 + 300 * MB;
  }
}

/**
 * The most pixels a single-image job should work at on this device: the largest size whose estimate stays under
 * the warning line, but never below `floor` (scaling a photo to a thumbnail helps nobody). For tools that shrink
 * big inputs to fit instead of refusing them.
 */
export function maxPixels(job: 'image-ai' | 'upscale' | 'collage', device: DeviceSpec = deviceSpec(), floor = 4e6): number {
  const fixed = estimateMemory(job, { width: 0, height: 0 });
  const perPixel = estimateMemory(job, { width: 1000, height: 1000 }) / 1e6 - fixed / 1e6;
  return Math.max(floor, Math.floor((0.75 * memoryBudget(device).bytes - fixed) / perPixel));
}

const ok: Verdict = { level: 'ok', message: '' };
const mb = (bytes: number) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / MB))} MB`);

/** hard limits: these fail on any device of this kind, whatever its memory */
function hardLimit(job: Job, l: Load, d: DeviceSpec, tip: string): string | null {
  if (job === 'ffmpeg') {
    const need = (l.outBytes ?? l.bytes ?? 0) + 200 * MB;
    if (need > FFMPEG_HEAP) return `This ${NOUN[job]} is too big for the backup converter this format needs: it can hold at most 2 GB at once. ${tip}`;
  }
  if (job === 'collage' || job === 'upscale') {
    const area = d.ios ? CANVAS_AREA.ios : CANVAS_AREA.other;
    const w = Math.round(l.width ?? 0);
    const h = Math.round(l.height ?? 0);
    if (w * h > area || Math.max(w, h) > CANVAS_SIDE) {
      const limit = d.ios ? 'Safari on iPhone and iPad draws at most 16.7 megapixels' : `browsers draw at most ${area / 1e6 >= 100 ? Math.round(area / 1e6) : (area / 1e6).toFixed(1)} megapixels`;
      return `The ${NOUN[job]} would be ${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} pixels, and ${limit}. ${tip}`;
    }
  }
  return null;
}

/**
 * Should this run start on this device? `level` is ok, warn (start it, but show `message`) or block (don't start;
 * show `message`). Messages name the problem and a lighter setting to try.
 */
export function checkDevice(job: Job, load: Load, device: DeviceSpec = deviceSpec()): Verdict {
  const tip = load.tip ?? TIPS[job];
  const hard = hardLimit(job, load, device, tip);
  if (hard) return { level: 'block', message: hard };

  const need = estimateMemory(job, load);
  const budget = memoryBudget(device);
  // what the tool needs before the file adds anything (model, runtime, buffers): when that alone crosses a line,
  // the device is the problem, not the file, and advice about the file would be wrong
  const base = estimateMemory(job, { width: 0, height: 0, count: 0 });
  // 8 means "8 GB or more", so only smaller devices are blocked on memory
  if (budget.known && device.memoryGB! < 8 && need > 2 * budget.bytes)
    return {
      level: 'block',
      message:
        base > 2 * budget.bytes
          ? `This tool needs about ${mb(base)} of memory even for a small file, more than a browser tab gets on a device with ${device.memoryGB} GB. Try it on a computer or a device with more memory.`
          : `This ${NOUN[job]} is too big for this device: it needs about ${mb(need)} of memory, more than a browser tab gets on a device with ${device.memoryGB} GB. ${tip}`,
    };
  if (need > 0.75 * budget.bytes)
    return {
      level: 'warn',
      message:
        base > 0.75 * budget.bytes
          ? 'This tool uses a lot of memory and this device has little to spare, so it may not finish. Close other tabs and apps first.'
          : `This ${NOUN[job]} is big for this device's memory, so it may not finish. ${tip}`,
    };

  // single-threaded or CPU-bound work that runs long on slow hardware
  const slow = device.mobile || device.cores <= 4;
  if (job === 'ffmpeg' && (load.seconds ?? 0) > (slow ? 300 : 1200))
    return { level: 'warn', message: 'This format goes through the slower backup converter, so a file this long can take a long time. Keep this tab open until it finishes.' };
  if (job === 'ocr' && (load.count ?? 0) > (slow ? 40 : 150))
    return { level: 'warn', message: `Reading ${load.count} pages can take a long time on this device. Keep this tab open, or pick fewer pages.` };
  return ok;
}

/** the error a blocked check throws inside shared code; its message is safe to show */
export class DeviceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceLimitError';
  }
}

/** throws DeviceLimitError when the check blocks; returns the verdict otherwise (ok or warn) */
export function guard(job: Job, load: Load, device?: DeviceSpec): Verdict {
  const v = checkDevice(job, load, device);
  if (v.level === 'block') throw new DeviceLimitError(v.message);
  return v;
}

const OOM =
  /out of memory|\boom\b|allocation failed|array buffer allocation|memory access out of bounds|cannot enlarge memory|could not allocate|cannot allocate|failed to allocate|allocation size overflow|canvas memory|exceeds the maximum|invalid array length|invalid typed array length|createBuffer/i;

/**
 * Whether an error is the device running out of memory, in any of the shapes engines throw: RangeError from an
 * ArrayBuffer allocation, a wasm "Aborted(OOM)" or out-of-bounds trap, Safari's canvas memory limit, or an engine
 * error already coded 'out-of-memory' (also through `cause`).
 */
export function isOutOfMemory(err: unknown, depth = 0): boolean {
  if (!err || depth > 4) return false;
  const e = err as { name?: string; message?: string; code?: unknown; cause?: unknown };
  if (e.code === 'out-of-memory') return true;
  const message = typeof err === 'string' ? err : (e.message ?? '');
  if (OOM.test(message)) return true;
  if (e.name === 'RangeError' && /alloc|array|buffer|memory|size|length/i.test(message)) return true;
  return isOutOfMemory(e.cause, depth + 1);
}

/** "This video is too big for this device: it ran out of memory. Try 720p …" */
export function tooBigMessage(job: Job, tip = TIPS[job]) {
  return `This ${NOUN[job]} is too big for this device: it ran out of memory. ${tip}`;
}

/** the friendly text for a blocked check or an out-of-memory error, or null for any other error */
export function deviceMessage(job: Job, err: unknown, tip?: string): string | null {
  if (err instanceof DeviceLimitError || (err as Error)?.name === 'DeviceLimitError') return (err as Error).message;
  return isOutOfMemory(err) ? tooBigMessage(job, tip) : null;
}

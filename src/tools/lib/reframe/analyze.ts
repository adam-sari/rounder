import { extractFrames, throwIfAborted, type MediaInfo } from '@/engines/media';
import type { Detector } from './faces';
import type { Analysis, Sample } from './path';
import { changeScore, findCuts, focusPoint, lumaOf, refineCut, type Box } from './signal';

/*
 * Watches the video once: faces on ~5 frames a second (fewer for very long videos), a tiny
 * grayscale copy of each frame for scene cuts and motion, then the exact frame of every cut.
 * Frames are decoded in the media worker in small batches, so memory stays flat; detection
 * runs here between frames, handing the page back each time so it never freezes.
 */

const FPS = 5;
const MAX_SAMPLES = 3000;
const BATCH = 40;
/** analysis frames: long side in px (faces in a 1080p frame are still ~50 px at this size) */
const DETECT_PX = 640;
/** width of the grayscale frames used for cuts and motion */
const LUMA_W = 64;
/** most frames to decode between two samples when pinning a cut */
const REFINE_MAX = 12;

export interface AnalyzeControl {
  signal?: AbortSignal;
  onProgress?: (fraction: number, faces: number) => void;
  /** the frame just analysed, with its faces (for a live preview); drawn before the frame is freed */
  onFrame?: (frame: ImageBitmap, faces: Box[]) => void;
}

let canvas: OffscreenCanvas | null = null;

function lumaFrame(bitmap: ImageBitmap, w: number, h: number): Uint8Array {
  canvas ??= new OffscreenCanvas(w, h);
  if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return lumaOf(ctx.getImageData(0, 0, w, h).data);
}

/** hands the page back for input and paint; a message, not a timer, so a background tab isn't throttled to one frame a second */
const yieldToPage = () =>
  new Promise<void>((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });

export async function analyze(file: Blob, info: MediaInfo, detector: Detector, ctl: AnalyzeControl = {}): Promise<Analysis> {
  const { signal } = ctl;
  const duration = info.durationSec;
  const W = info.video?.displayWidth ?? 16;
  const H = info.video?.displayHeight ?? 9;
  const lw = LUMA_W;
  const lh = Math.max(8, Math.round((LUMA_W * H) / W));
  const fps = Math.min(FPS, MAX_SAMPLES / Math.max(duration, 1));
  const times = Array.from({ length: Math.max(1, Math.floor(duration * fps)) }, (_, k) => k / fps);
  const size = W >= H ? { width: Math.min(DETECT_PX, W) } : { height: Math.min(DETECT_PX, H) };

  const samples: Sample[] = [];
  const lumas: Uint8Array[] = [];
  let faces = 0;
  for (let b = 0; b < times.length; b += BATCH) {
    const frames = await extractFrames(file, { times: times.slice(b, b + BATCH), ...size }, { signal });
    try {
      for (const f of frames) {
        throwIfAborted(signal);
        const found = detector.detect(f.bitmap);
        faces += found.length ? 1 : 0;
        samples.push({ t: f.time, faces: found, focus: null });
        lumas.push(lumaFrame(f.bitmap, lw, lh));
        ctl.onFrame?.(f.bitmap, found);
        f.bitmap.close();
        ctl.onProgress?.((samples.length / times.length) * 0.92, faces);
        await yieldToPage();
      }
    } finally {
      frames.forEach((f) => f.bitmap.close());
    }
  }

  const sampleTimes = samples.map((s) => s.t);
  const cutIdx = findCuts(
    lumas.map((l, i) => (i ? changeScore(lumas[i - 1], l) : 0)),
    sampleTimes,
  );
  const cutSet = new Set(cutIdx);
  samples.forEach((s, i) => (s.focus = focusPoint(lumas[i], i && !cutSet.has(i) ? lumas[i - 1] : null, lw, lh)));

  const cuts = await pinCuts(file, cutIdx.map((i) => [sampleTimes[i - 1], sampleTimes[i]]), info.video?.fps || 30, lw, lh, signal);
  ctl.onProgress?.(1, faces);
  return { duration, samples, cuts };
}

/** decodes every frame inside each sampled gap (one batch for all cuts) and finds the exact change */
async function pinCuts(file: Blob, gaps: [number, number][], fps: number, lw: number, lh: number, signal?: AbortSignal): Promise<number[]> {
  const spans = gaps.map(([a, b]) => {
    const step = Math.max(1 / fps, (b - a) / REFINE_MAX);
    const ts = [a];
    for (let t = a + step; t < b - 1e-3; t += step) ts.push(t);
    return [...ts, b];
  });
  const wanted = [...new Set(spans.flat())];
  const decoded: { time: number; luma: Uint8Array }[] = [];
  if (wanted.length) {
    for (const f of await extractFrames(file, { times: wanted, width: lw, height: lh, fit: 'fill' }, { signal })) {
      decoded.push({ time: f.time, luma: lumaFrame(f.bitmap, lw, lh) });
      f.bitmap.close();
    }
  }
  // the engine clamps times to the first frame and skips undecodable ones, so match by nearest time
  // (a repeated frame just scores no change)
  const lumaAt = (t: number) => decoded.reduce((a, b) => (Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a)).luma;
  return spans.map((ts) => (decoded.length ? refineCut(ts, ts.map(lumaAt)) : (ts[0] + ts.at(-1)!) / 2));
}

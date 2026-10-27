/*
 * Downloads: the depth map as a full-size PNG, and the 3D photo as a seamless loop (MP4/WebM
 * through the media engine, or GIF). Browser-only (canvas, WebGL).
 */
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { imagesToVideo } from '@/engines/media';
import { colorize, type Colormap } from './colormap';
import { cameraAt, fitSize, frameDuration, overscan, type Motion } from './motion';
import { Parallax, type DepthMap } from './parallax';

export type LoopFormat = 'mp4' | 'webm' | 'gif';

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas is empty'))), type, quality));

const canvas2d = (width: number, height: number) => {
  const c = Object.assign(document.createElement('canvas'), { width, height });
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
};

/** the depth map upscaled (smoothly) to width × height and colored, as a PNG */
export async function depthPng(depth: DepthMap, width: number, height: number, map: Colormap, invert: boolean): Promise<Blob> {
  const [small, sctx] = canvas2d(depth.width, depth.height);
  sctx.putImageData(new ImageData(colorize(depth.data, 'gray'), depth.width, depth.height), 0, 0);
  const [big, ctx] = canvas2d(width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, width, height);
  const px = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = px[i * 4];
  ctx.putImageData(new ImageData(colorize(gray, map, invert), width, height), 0, 0);
  return toBlob(big, 'image/png');
}

export interface LoopSpec {
  image: ImageData;
  /** dilated depth, as shown in the preview */
  depth: DepthMap;
  motion: Motion;
  amount: number;
  focus: number;
  seconds: number;
}

/** renders one loop of the 3D photo and encodes it; progress 0–1 covers rendering and encoding */
export async function renderLoop(spec: LoopSpec, format: LoopFormat, ctl: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<Blob> {
  const gif = format === 'gif';
  const { width, height } = fitSize(spec.image.width, spec.image.height, gif ? 480 : 1080);
  const fps = gif ? 15 : 30;
  const frames = Math.round(spec.seconds * fps);
  const scale = overscan(spec.motion, spec.amount, spec.focus);
  const gl = Object.assign(document.createElement('canvas'), { width, height });
  const r = new Parallax(gl, { preserveDrawingBuffer: true });
  try {
    r.setImage(spec.image);
    r.setDepth(spec.depth);
    const draw = (i: number) => r.render(cameraAt(spec.motion, i / frames, spec.amount), spec.focus, scale);
    const rendered = (i: number) => ctl.onProgress?.(((i + 1) / frames) * (gif ? 1 : 0.5));

    if (gif) {
      const [, ctx] = canvas2d(width, height);
      const enc = GIFEncoder();
      let palette: number[][] = [];
      for (let i = 0; i < frames; i++) {
        ctl.signal?.throwIfAborted();
        draw(i);
        ctx.drawImage(gl, 0, 0);
        const data = ctx.getImageData(0, 0, width, height).data;
        // the frames share their colors, so one palette fits all and nothing flickers
        if (!i) palette = quantize(data, 256);
        // GIF delays are centiseconds; accumulate so rounding doesn't drift the speed
        const delay = (Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps)) * 10;
        enc.writeFrame(applyPalette(data, palette), width, height, { palette, delay, repeat: 0 });
        rendered(i);
        await new Promise((resolve) => setTimeout(resolve));
      }
      enc.finish();
      return new Blob([enc.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
    }

    const stills: Blob[] = [];
    for (let i = 0; i < frames; i++) {
      ctl.signal?.throwIfAborted();
      draw(i);
      stills.push(await toBlob(gl, 'image/jpeg', 0.95));
      rendered(i);
    }
    const out = await imagesToVideo(
      stills,
      { container: format, width, height, fps, durations: frameDuration(fps), transition: 'none', fit: 'cover', quality: 'high' },
      { onProgress: (p) => ctl.onProgress?.(0.5 + p / 2), signal: ctl.signal },
    );
    return out.blob;
  } finally {
    r.dispose();
  }
}

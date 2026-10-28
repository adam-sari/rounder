import { reduceColors } from './quantize';
import type { EncodeOptions, ResizeOptions } from './types';

// The wasm codecs behind the image worker (jSquash), apart from the worker plumbing so the npm packages can share them.

export async function resize(img: ImageData, o: ResizeOptions): Promise<ImageData> {
  const width = Math.max(1, Math.round(o.width));
  const height = Math.max(1, Math.round(o.height));
  if (width === img.width && height === img.height) return img;
  const { default: resizeImage } = await import('@jsquash/resize');
  return resizeImage(img, { width, height, method: o.method ?? 'lanczos3', fitMethod: 'stretch', premultiply: true, linearRGB: true });
}

/** paints transparent pixels onto a solid color, for formats without alpha */
export function flatten(img: ImageData, background: string): ImageData {
  const hex = background.replace('#', '');
  const [br, bg, bb] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
  const d = img.data;
  let opaque = true;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 255) {
      opaque = false;
      break;
    }
  }
  if (opaque) return img;
  const out = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    out[i] = d[i] * a + br * (1 - a);
    out[i + 1] = d[i + 1] * a + bg * (1 - a);
    out[i + 2] = d[i + 2] * a + bb * (1 - a);
    out[i + 3] = 255;
  }
  return new ImageData(out, img.width, img.height);
}

export async function encode(img: ImageData, o: EncodeOptions): Promise<ArrayBuffer> {
  switch (o.format) {
    case 'jpeg': {
      const { default: encodeJpeg } = await import('@jsquash/jpeg/encode');
      return encodeJpeg(flatten(img, o.background ?? '#ffffff'), { quality: o.quality ?? 80, progressive: o.progressive ?? true });
    }
    case 'webp': {
      const { default: encodeWebp } = await import('@jsquash/webp/encode');
      return encodeWebp(img, { quality: o.quality ?? 80, lossless: o.lossless ? 1 : 0, method: 4 });
    }
    case 'avif': {
      const { default: encodeAvif } = await import('@jsquash/avif/encode');
      return encodeAvif(img, { quality: o.quality ?? 60, lossless: !!o.lossless, speed: 6 });
    }
    case 'png': {
      const source = o.colors && o.colors <= 256 ? reduceColors(img, o.colors, o.dither ?? true) : img;
      const { default: optimise } = await import('@jsquash/oxipng/optimise');
      return optimise(source, { level: 2, interlace: false, optimiseAlpha: true });
    }
  }
}


import { decodeImage, imageKind, toDecodable } from '@/engines/image/client';
import { ocrScale, toPgm } from './text';

export interface PreparedImage {
  /** grayscale PGM for Tesseract, enlarged or shrunk by `scale` */
  image: Uint8Array<ArrayBuffer>;
  scale: number;
  /** the image as shown (EXIF rotation applied) */
  width: number;
  height: number;
  /** object URL the browser can show; revoke it when done */
  preview: string;
}

// what <img> can show as is; HEIC and TIFF get a JPEG preview instead
const SHOWABLE = new Set(['jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif']);

async function bitmapOf(file: File): Promise<ImageBitmap> {
  const src = await toDecodable(file);
  if (src instanceof ImageBitmap) return src;
  try {
    return await createImageBitmap(src);
  } catch {
    // formats the browser can't decode go through the image engine's codecs
    return createImageBitmap(await decodeImage(file));
  }
}

const canvasOf = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/** Decodes any image the site can read and turns it into what Tesseract wants */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const [kind, bitmap] = await Promise.all([imageKind(file), bitmapOf(file)]);
  try {
    const { width, height } = bitmap;
    const scale = ocrScale(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = canvasOf(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const image = toPgm(ctx.getImageData(0, 0, w, h).data, w, h);
    canvas.width = 0;

    let preview: string;
    if (SHOWABLE.has(kind)) preview = URL.createObjectURL(file);
    else {
      const view = canvasOf(width, height);
      view.getContext('2d')!.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((r) => view.toBlob(r, 'image/jpeg', 0.9));
      view.width = 0;
      if (!blob) throw new Error('preview failed');
      preview = URL.createObjectURL(blob);
    }
    return { image, scale, width, height, preview };
  } finally {
    bitmap.close();
  }
}

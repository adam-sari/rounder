/**
 * Fetches the images a document links to, once each, so the preview and the
 * PDF show the same thing. PNG and JPEG go into the PDF as they are; other
 * formats (WebP, GIF, AVIF, SVG…) are redrawn on a canvas first. Browser only.
 */
import type { PdfImage } from './pdf';

export type ImageResult =
  | ({ ok: true; url: string } & PdfImage)
  /** relative: a path like images/a.png, which has nothing to resolve against here */
  | { ok: false; reason: 'relative' | 'blocked' | 'broken' };

function sniff(b: Uint8Array): 'png' | 'jpg' | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  return null;
}

async function jpegOrientation(bytes: Uint8Array): Promise<number> {
  try {
    const { default: exifr } = await import('exifr');
    return (await exifr.orientation(bytes)) ?? 1;
  } catch {
    return 1;
  }
}

export async function loadImage(src: string): Promise<ImageResult> {
  if (!/^(https?:|data:image\/|blob:)/i.test(src)) return { ok: false, reason: 'relative' };
  let blob: Blob;
  try {
    // no referrer: the image's site doesn't need to know which page asked; a stalled
    // server must not leave Download PDF waiting forever
    const res = await fetch(src, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { ok: false, reason: 'broken' };
    blob = await res.blob();
  } catch {
    // usually a site that doesn't let other pages read its images (CORS)
    return { ok: false, reason: 'blocked' };
  }
  const url = URL.createObjectURL(blob);
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let kind = sniff(bytes);
    // a rotated phone photo is drawn upright by the browser but stored sideways; the
    // PDF would show the raw pixels, so it's redrawn (canvas applies the rotation)
    if (kind === 'jpg' && (await jpegOrientation(bytes)) > 1) kind = null;
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || 300;
    const h = img.naturalHeight || 150;
    if (kind) return { ok: true, url, w, h, bytes, kind };

    const svg = blob.type.includes('svg') || /^\s*(<\?xml|<svg)/i.test(new TextDecoder().decode(bytes.subarray(0, 256)));
    // vectors are drawn at 2× so they stay sharp; huge rasters are capped to keep memory sane
    const scale = Math.min(svg ? 2 : 1, 4096 / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // photos (no transparency) become JPEG, which keeps the PDF small
    let opaque = !svg;
    if (opaque) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) {
          opaque = false;
          break;
        }
      }
    }
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, opaque ? 'image/jpeg' : 'image/png', 0.92));
    canvas.width = 0;
    if (!out) throw new Error('encode failed');
    return { ok: true, url, w, h, bytes: new Uint8Array(await out.arrayBuffer()), kind: opaque ? 'jpg' : 'png' };
  } catch {
    URL.revokeObjectURL(url);
    return { ok: false, reason: 'broken' };
  }
}

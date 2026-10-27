import { getPageSize, renderPage, type PageSize, type PdfDoc } from '@/engines/pdf';
import type { Raster } from './pixels';

export interface RenderedPair {
  /** white canvases of one shared size, pages drawn from the top-left; null for a page that doesn't exist */
  a: HTMLCanvasElement | null;
  b: HTMLCanvasElement | null;
  sizes: (PageSize | null)[];
  width: number;
  height: number;
}

/**
 * Renders both pages of a pair at the same scale onto canvases of the same
 * size, so pixel (x, y) means the same spot on both. `scaleFor` gets the
 * larger width and height in points and returns the scale (1 = 72 dpi).
 */
export async function renderPair(docs: [PdfDoc, PdfDoc], pages: [number, number], scaleFor: (w: number, h: number) => number, signal?: AbortSignal): Promise<RenderedPair> {
  const sizes = await Promise.all(pages.map((p, i) => (p < 0 ? null : getPageSize(docs[i], p))));
  const w = Math.max(...sizes.map((s) => s?.width ?? 0));
  const h = Math.max(...sizes.map((s) => s?.height ?? 0));
  const scale = scaleFor(w, h);
  const width = Math.max(1, Math.ceil(w * scale));
  const height = Math.max(1, Math.ceil(h * scale));
  const [a, b] = await Promise.all(
    pages.map(async (p, i) => {
      if (p < 0) return null;
      const page = await renderPage(docs[i], p, { scale, signal });
      const canvas = Object.assign(document.createElement('canvas'), { width, height });
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(page, 0, 0);
      page.width = 0;
      return canvas;
    }),
  );
  return { a, b, sizes, width, height };
}

export function rasterOf(canvas: HTMLCanvasElement): Raster {
  const { data, width, height } = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}

/** Scale that fits `maxPx` pixels at most, and never above `cap` */
export const fitScale = (cap: number, maxPx: number) => (w: number, h: number) => Math.min(cap, Math.sqrt(maxPx / Math.max(1, w * h)));

/** Identifies a page pair across re-comparisons, for caching its visual score */
export const pairKey = (docs: [PdfDoc, PdfDoc], { a, b }: { a: number; b: number }) => `${docs[0].id}:${a}|${docs[1].id}:${b}`;

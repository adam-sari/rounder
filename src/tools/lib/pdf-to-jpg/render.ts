import { pdfName } from '@/engines/pdf/lib';

export type Sizing = { mode: 'dpi'; dpi: number } | { mode: 'width'; width: number };

export interface CanvasLimits {
  /** longest canvas side browsers reliably draw */
  maxSide: number;
  /** width × height cap */
  maxPixels: number;
}

/** desktop browsers handle far more, but a 120 MP canvas is already ~480 MB of memory */
export const DESKTOP_LIMITS: CanvasLimits = { maxSide: 16_384, maxPixels: 120_000_000 };
/** iOS Safari refuses canvases over ~16.7 MP */
export const IOS_LIMITS: CanvasLimits = { maxSide: 16_384, maxPixels: 16_777_216 };

export interface RenderPlan {
  /** pdf.js scale (1 = 72 dpi) */
  scale: number;
  width: number;
  height: number;
  /** the resolution actually used */
  dpi: number;
  /** true when the size was lowered to fit the canvas limits */
  limited: boolean;
}

/** Pixel size for a page of pageW × pageH points (as displayed), capped to the limits */
export function planRender(pageW: number, pageH: number, sizing: Sizing, limits: CanvasLimits = DESKTOP_LIMITS): RenderPlan {
  let scale = sizing.mode === 'dpi' ? sizing.dpi / 72 : sizing.width / pageW;
  const wanted = scale;
  scale = Math.min(scale, limits.maxSide / Math.max(pageW, pageH));
  const px = pageW * pageH * scale * scale;
  if (px > limits.maxPixels) scale *= Math.sqrt(limits.maxPixels / px);
  // matches how the renderer rounds the canvas size
  const width = Math.max(1, Math.floor(pageW * scale));
  const height = Math.max(1, Math.floor(pageH * scale));
  return { scale, width, height, dpi: Math.round(scale * 72), limited: scale < wanted - 1e-9 };
}

/** "Report.pdf", page index 2 of 120 → "Report-page-003.jpg"; padded so files sort in order */
export function pageImageName(fileName: string, pageIndex: number, ext: string, numPages = 1) {
  const n = String(pageIndex + 1).padStart(String(numPages).length, '0');
  return pdfName(fileName, `-page-${n}`, ext);
}

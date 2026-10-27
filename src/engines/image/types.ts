export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'avif';

export const formatInfo: Record<OutputFormat, { label: string; ext: string; mime: string; lossy: boolean; alpha: boolean }> = {
  jpeg: { label: 'JPG', ext: 'jpg', mime: 'image/jpeg', lossy: true, alpha: false },
  png: { label: 'PNG', ext: 'png', mime: 'image/png', lossy: false, alpha: true },
  webp: { label: 'WebP', ext: 'webp', mime: 'image/webp', lossy: true, alpha: true },
  avif: { label: 'AVIF', ext: 'avif', mime: 'image/avif', lossy: true, alpha: true },
};

export interface EncodeOptions {
  format: OutputFormat;
  /** 0–100; ignored for lossless output */
  quality?: number;
  /** webp / avif lossless mode */
  lossless?: boolean;
  /**
   * png only: reduce to at most this many colors (2–256) before optimising,
   * the same trick TinyPNG uses. Omit for a lossless png.
   */
  colors?: number;
  /** png color reduction: spread the error to hide banding */
  dither?: boolean;
  /** fill color behind transparent pixels when the format has no alpha (jpeg) */
  background?: string;
  /** jpeg: progressive scan */
  progressive?: boolean;
}

export type ResizeMethod = 'lanczos3' | 'mitchell' | 'catrom' | 'triangle';

export interface ResizeOptions {
  width: number;
  height: number;
  method?: ResizeMethod;
}

/** how to size an image whose dimensions are only known after decoding */
export interface ResizeSpec {
  /**
   * fit: keep the aspect ratio inside width × height (either may be omitted)
   * fill: cover width × height exactly, cropping the overflow from the centre
   * stretch: exactly width × height, ignoring the aspect ratio
   * scale: a percentage of the original
   */
  mode: 'fit' | 'fill' | 'stretch' | 'scale';
  width?: number;
  height?: number;
  percent?: number;
  /** allow making images bigger than the original (default false) */
  enlarge?: boolean;
  method?: ResizeMethod;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Works out the scaled size (and centre crop for 'fill') for an image of w × h */
export function resolveSize(w: number, h: number, spec: ResizeSpec): { width: number; height: number; crop?: Rect } {
  const round = (n: number) => Math.max(1, Math.round(n));
  const cap = (s: number) => (spec.enlarge ? s : Math.min(1, s));
  switch (spec.mode) {
    case 'scale': {
      const s = (spec.percent ?? 100) / 100;
      return { width: round(w * s), height: round(h * s) };
    }
    case 'stretch':
      return { width: round(spec.width ?? w), height: round(spec.height ?? h) };
    case 'fit': {
      const s = cap(Math.min(spec.width ? spec.width / w : Infinity, spec.height ? spec.height / h : Infinity, spec.width || spec.height ? Infinity : 1));
      return { width: round(w * s), height: round(h * s) };
    }
    case 'fill': {
      const W = spec.width ?? w;
      const H = spec.height ?? h;
      const s = Math.max(W / w, H / h);
      const width = round(w * s);
      const height = round(h * s);
      return { width, height, crop: { x: Math.floor((width - W) / 2), y: Math.floor((height - H) / 2), width: round(W), height: round(H) } };
    }
  }
}

export interface Job {
  /** cut out this region of the source first (source pixels) */
  crop?: Rect;
  resize?: ResizeSpec;
  /** rotate clockwise, applied after resize */
  rotate?: 0 | 90 | 180 | 270;
  flipX?: boolean;
  flipY?: boolean;
  encode: EncodeOptions;
}

export interface JobResult {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  /** original pixel size before any resize */
  sourceWidth: number;
  sourceHeight: number;
}

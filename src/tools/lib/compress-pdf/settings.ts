export type Level = 'light' | 'recommended' | 'strong' | 'custom';

export interface CompressSettings {
  level: Level;
  /** custom level only */
  dpi: number;
  /** custom level only, JPEG quality 1–100 */
  quality: number;
  grayscale: boolean;
  stripMetadata: boolean;
}

/** what the image pass does; null when images are left alone */
export interface ImageOptions {
  /** images are downscaled to this resolution at the largest size they could be drawn */
  dpi: number;
  quality: number;
  grayscale: boolean;
}

export const LEVELS: { id: Level; name: string; hint: string; dpi?: number; quality?: number }[] = [
  { id: 'light', name: 'Light', hint: 'lossless · images untouched' },
  { id: 'recommended', name: 'Recommended', hint: '150 dpi · great for sharing', dpi: 150, quality: 75 },
  { id: 'strong', name: 'Strong', hint: '100 dpi · smallest files', dpi: 100, quality: 60 },
  { id: 'custom', name: 'Custom', hint: 'pick resolution and quality' },
];

export const DEFAULT_SETTINGS: CompressSettings = { level: 'recommended', dpi: 150, quality: 75, grayscale: false, stripMetadata: false };

export function imageOptions(s: CompressSettings): ImageOptions | null {
  if (s.level === 'light') return null;
  const preset = LEVELS.find((l) => l.id === s.level)!;
  return { dpi: preset.dpi ?? s.dpi, quality: preset.quality ?? s.quality, grayscale: s.grayscale };
}

/** longest side we trace at; tracing time grows with the pixel count */
export const MAX_TRACE = 1500;

export interface TraceSettings {
  mode: 'color' | 'bw';
  /** color mode: palette size */
  colors: number;
  /** bw mode: luminance below this turns black */
  threshold: number;
  /** 0–9: higher keeps smaller specks */
  detail: number;
  /** 0–9: higher fits looser, simpler curves */
  smoothing: number;
  /** 0–5 selective blur before tracing */
  blur: number;
  /** clear the color that touches the edges */
  removeBg: boolean;
}

export type PresetId = 'logo' | 'illustration' | 'bw' | 'detailed';

type Preset = Omit<TraceSettings, 'removeBg'>;

export const presets: Record<PresetId, Preset> = {
  logo: { mode: 'color', colors: 6, threshold: 128, detail: 4, smoothing: 4, blur: 0 },
  illustration: { mode: 'color', colors: 16, threshold: 128, detail: 5, smoothing: 4, blur: 1 },
  bw: { mode: 'bw', colors: 2, threshold: 128, detail: 4, smoothing: 4, blur: 0 },
  detailed: { mode: 'color', colors: 48, threshold: 128, detail: 9, smoothing: 2, blur: 0 },
};

export const presetLabels: [PresetId, string][] = [['logo', 'logo / flat'], ['illustration', 'illustration'], ['bw', 'black & white'], ['detailed', 'detailed']];

/** the preset these settings match, if any */
export function matchPreset(s: TraceSettings): PresetId | undefined {
  return (Object.keys(presets) as PresetId[]).find((id) => {
    const p = presets[id];
    const tone = s.mode === 'bw' ? p.threshold === s.threshold : p.colors === s.colors;
    return p.mode === s.mode && tone && p.detail === s.detail && p.smoothing === s.smoothing && p.blur === s.blur;
  });
}

/** imagetracer's knobs for a 0–9 detail / smoothing setting */
export const PATH_OMIT = [32, 24, 16, 12, 8, 6, 4, 2, 1, 0];
export const ERROR_TOLERANCE = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

export interface TraceResult {
  svg: string;
  paths: number;
  colors: number;
  /** the edge color that was removed, as #rrggbb */
  removed?: string;
}

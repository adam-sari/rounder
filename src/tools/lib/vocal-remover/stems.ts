/*
 * Pure stem/mixer logic for the vocal remover: which stems exist, how mute/solo/volume turn into
 * gains, the karaoke/acapella presets, mixing and file names. No DOM, so it runs in tests.
 */
import { withExtension } from '@/tools/lib/files';

/** Demucs (htdemucs) works on 44.1 kHz stereo */
export const RATE = 44100;
/** longest song we take: the four stems of 15 minutes already need ~1.3 GB of memory */
export const MAX_SECONDS = 15 * 60;
/** past this, warn that it will be slow and memory-hungry */
export const LONG_SECONDS = 8 * 60;
/** waveform resolution per stem */
export const PEAK_BUCKETS = 1600;

export type StemId = 'vocals' | 'drums' | 'bass' | 'other';

export const STEMS: { id: StemId; label: string; hint: string; color: string }[] = [
  { id: 'vocals', label: 'Vocals', hint: 'lead and backing voices', color: 'var(--color-ai)' },
  { id: 'drums', label: 'Drums', hint: 'kit and percussion', color: 'var(--color-video)' },
  { id: 'bass', label: 'Bass', hint: 'bass guitar and synth bass', color: 'var(--color-image)' },
  { id: 'other', label: 'Other', hint: 'guitars, keys, strings, synths', color: 'var(--color-sun)' },
];

export const STEM_IDS = STEMS.map((s) => s.id);

export interface Channel {
  /** 0–1 */
  volume: number;
  muted: boolean;
  solo: boolean;
}

export type Mix = Record<StemId, Channel>;

export type PresetId = 'all' | 'instrumental' | 'acapella';

export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'all', label: 'Full song', hint: 'every stem' },
  { id: 'instrumental', label: 'Instrumental', hint: 'karaoke: no vocals' },
  { id: 'acapella', label: 'Acapella', hint: 'vocals only' },
];

const channel = (o: Partial<Channel> = {}): Channel => ({ volume: 1, muted: false, solo: false, ...o });

export function presetMix(id: PresetId): Mix {
  return {
    vocals: channel(id === 'instrumental' ? { muted: true } : id === 'acapella' ? { solo: true } : {}),
    drums: channel(),
    bass: channel(),
    other: channel(),
  };
}

/** which preset the mix is exactly, if any (for the preset buttons' pressed state) */
export function matchPreset(mix: Mix): PresetId | null {
  const same = (a: Mix) => STEM_IDS.every((id) => a[id].volume === mix[id].volume && a[id].muted === mix[id].muted && a[id].solo === mix[id].solo);
  return PRESETS.find((p) => same(presetMix(p.id)))?.id ?? null;
}

/** What each stem is heard at: mute always wins; with any solo on, only soloed stems play */
export function effectiveGains(mix: Mix): Record<StemId, number> {
  const soloing = STEM_IDS.some((id) => mix[id].solo);
  return Object.fromEntries(STEM_IDS.map((id) => [id, mix[id].muted || (soloing && !mix[id].solo) ? 0 : mix[id].volume])) as Record<StemId, number>;
}

export const isSilent = (gains: Record<StemId, number>) => STEM_IDS.every((id) => gains[id] === 0);

/** Sums stereo stems with gains into a new stereo pair (stems missing from `stems` count as silent) */
export function mixStems(stems: Partial<Record<StemId, Float32Array[]>>, gains: Record<StemId, number>): Float32Array[] {
  const frames = Object.values(stems)[0]?.[0]?.length ?? 0;
  const out = [new Float32Array(frames), new Float32Array(frames)];
  for (const id of STEM_IDS) {
    const g = gains[id];
    const src = stems[id];
    if (!g || !src) continue;
    for (let c = 0; c < 2; c++) {
      const s = src[c] ?? src[0];
      const o = out[c];
      for (let i = 0; i < frames; i++) o[i] += s[i] * g;
    }
  }
  return out;
}

export type ExportPart = StemId | 'instrumental' | 'mix';

const PART_NAMES: Record<ExportPart, string> = {
  vocals: 'vocals',
  drums: 'drums',
  bass: 'bass',
  other: 'other',
  instrumental: 'instrumental',
  mix: 'custom mix',
};

/** "My Song.flac" + 'instrumental' + 'mp3' → "My Song (instrumental).mp3" */
export function exportName(source: string, part: ExportPart, ext: string): string {
  return withExtension(source, ext).replace(/(\.[^.]+)$/, ` (${PART_NAMES[part]})$1`);
}

/** "My Song.mp3" → "My Song stems.zip" */
export const zipName = (source: string) => withExtension(source, 'zip').replace(/\.zip$/, ' stems.zip');

/** demucs-web's segment hop: 343 980-sample windows (≈7.8 s) with 25% overlap (its CONSTANTS) */
export const SEGMENT_STRIDE = Math.floor(343980 * 0.75);

/** how many windows demucs-web runs for a song (its own totalSegments can be one short) */
export const segmentCount = (frames: number) => Math.max(1, Math.ceil(frames / SEGMENT_STRIDE));

import type { MediaInfo } from '@/engines/media/types';
import type { Analysis } from './analyzer';
import { camelot, keyName } from './key';

/** BPM as shown: one decimal place */
export const roundBpm = (bpm: number) => Math.round(bpm * 10) / 10;

/** 120 → "120", 128.46 → "128.5" */
export function formatBpm(bpm: number): string {
  const r = roundBpm(bpm);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export type Confidence = 'high' | 'medium' | 'low';

export function confidenceLevel(c: number): Confidence {
  return c >= 0.6 ? 'high' : c >= 0.3 ? 'medium' : 'low';
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvRow {
  name: string;
  analysis: Analysis;
}

/** one line per song; ASCII key names so spreadsheets don't mangle ♯ and ♭ */
export function toCsv(rows: CsvRow[]): string {
  const head = ['file', 'duration_sec', 'bpm', 'bpm_confidence', 'half_time', 'double_time', 'key', 'camelot', 'key_confidence'];
  const lines = rows.map(({ name, analysis: { durationSec, tempo, key } }) =>
    [
      name,
      durationSec.toFixed(1),
      tempo ? formatBpm(tempo.bpm) : '',
      tempo ? confidenceLevel(tempo.confidence) : '',
      tempo ? formatBpm(roundBpm(tempo.bpm) / 2) : '',
      tempo ? formatBpm(roundBpm(tempo.bpm) * 2) : '',
      key ? keyName(key, true) : '',
      key ? camelot(key) : '',
      key ? confidenceLevel(key.confidence) : '',
    ]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}

/**
 * True when the browser can't decode this file's audio by itself and the ffmpeg fallback is needed.
 * Unlike `info.needsFallback`, video the browser can't decode doesn't count: only the sound is analyzed.
 */
export function needsDecoder(info: MediaInfo): boolean {
  return !info.readable || (!!info.audio && !info.audio.canDecode);
}

/** user-facing text for a MediaError code */
export function errorText(code: string | undefined, message: string): string {
  switch (code) {
    case 'aborted':
      return 'Cancelled.';
    case 'unsupported-input':
      return "This file isn't an audio or video format we can read.";
    case 'no-tracks':
      return 'This file has no audio track to analyze.';
    case 'out-of-memory':
      return 'Ran out of memory. Try this file on its own, or close some other tabs.';
    case 'ffmpeg-failed':
      return "The extra decoder couldn't read this file. It may be damaged or protected.";
    default:
      return message || 'Something went wrong while analyzing this file.';
  }
}

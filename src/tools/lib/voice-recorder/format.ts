import type { Capabilities, Container } from '@/engines/media/types';

/*
 * What the browser records into, what a recording can be saved as, and how files are named.
 */

/** MediaRecorder types for voice, best first: Opus is small and clear; Safari records AAC in MP4 */
const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'];

/** the first type the recorder accepts, or '' to let the browser pick its default */
export function pickAudioMime(isSupported: (type: string) => boolean): string {
  return (
    TYPES.find((t) => {
      try {
        return isSupported(t);
      } catch {
        return false;
      }
    }) ?? ''
  );
}

export type RecContainer = 'webm' | 'ogg' | 'm4a';

export interface RecordedFormat {
  container: RecContainer;
  /** a plain audio/* type, so <audio> and downloads treat it as sound */
  mime: string;
  codec: string;
}

export function recordedFormat(mime: string): RecordedFormat {
  const m = mime.toLowerCase();
  if (m.includes('mp4') || m.includes('aac')) return { container: 'm4a', mime: 'audio/mp4', codec: 'AAC' };
  if (m.includes('ogg')) return { container: 'ogg', mime: 'audio/ogg', codec: 'Opus' };
  return { container: 'webm', mime: 'audio/webm', codec: 'Opus' };
}

export type ExportFormat = 'mp3' | 'wav' | 'm4a' | 'original';

/** bits/s offered for MP3 and M4A; 128 kbps is plenty for speech */
export const LOSSY_RATES = [96_000, 128_000, 192_000];
export const DEFAULT_RATE = 128_000;

export const isLossy = (f: ExportFormat) => f === 'mp3' || f === 'm4a';

export interface ExportChoice {
  id: ExportFormat;
  label: string;
  ok: boolean;
  /** why it's disabled */
  note?: string;
}

/** save-as options for a recording; null caps = still checking the browser */
export function exportChoices(rec: RecContainer, caps: Pick<Capabilities, 'audio'> | null): ExportChoice[] {
  const list: ExportChoice[] = [
    { id: 'mp3', label: 'MP3', ok: true },
    { id: 'wav', label: 'WAV', ok: true },
  ];
  // an AAC recording already is an M4A: "original" covers it
  if (rec !== 'm4a') {
    const aac = !!caps?.audio.encode.includes('aac');
    list.push({ id: 'm4a', label: 'M4A', ok: aac, note: !caps ? 'Checking your browser…' : aac ? undefined : "This browser can't encode AAC audio." });
  }
  list.push({ id: 'original', label: `original ${rec.toUpperCase()}`, ok: true });
  return list;
}

export const targetContainer = (f: ExportFormat, rec: RecContainer): Container => (f === 'original' ? rec : f);

/** rough output size for the "about X MB" hint */
export function estimateBytes(
  f: ExportFormat,
  seconds: number,
  o: { bitrate?: number; sampleRate?: number; channels?: number; sourceBytesPerSec?: number },
): number {
  if (f === 'wav') return Math.round(seconds * (o.sampleRate ?? 48000) * Math.min(2, o.channels ?? 1) * 2) + 44;
  if (f === 'original') return Math.round(seconds * (o.sourceBytesPerSec ?? 16_000));
  return Math.round(((o.bitrate ?? DEFAULT_RATE) * seconds) / 8);
}

/** a recording's name made safe for a file name */
export function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').replace(/^[\s.-]+|[\s.-]+$/g, '');
  return clean.slice(0, 80).trim() || 'recording';
}

export const exportFileName = (name: string, ext: string, trimmed: boolean) => `${safeName(name)}${trimmed ? ' (trimmed)' : ''}.${ext}`;

/** "Recording 3" after "Recording 1" and "Recording 2", even if some were renamed or deleted */
export function nextRecordingName(existing: string[]): string {
  const used = existing.map((n) => Number(/^Recording (\d+)$/.exec(n.trim())?.[1] ?? 0));
  return `Recording ${Math.max(existing.length, ...used) + 1}`;
}

/** the selection leaves something out (a 5 ms tolerance absorbs float noise from the handles) */
export const isTrimmed = (start: number, end: number, duration: number) => start > 0.005 || end < duration - 0.005;

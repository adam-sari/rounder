import { spawn, spawnSync } from 'node:child_process';
import { parseFfmpegProbe, parseFfmpegTime } from '@/engines/media/ffargs';
import type { MediaInfo } from '@/engines/media/types';
import { abortError, RounderError } from '../../core/errors';
import { FFMPEG_HINT, requireFfmpeg } from './ffmpeg-bin';

export * from './ffmpeg-bin';

let encoderList: Set<string> | undefined;

/** the encoders this ffmpeg build has (cached): LGPL-only builds lack libx264, some lack libmp3lame */
export function encoders(): Set<string> {
  if (encoderList) return encoderList;
  const r = spawnSync(requireFfmpeg(), ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true });
  encoderList = new Set([...(r.stdout ?? '').matchAll(/^ [VAS][\w.]{5} (\S+)/gm)].map((m) => m[1]));
  return encoderList;
}

/** a path ffmpeg can't mistake for a protocol (concat:, subfile:) or an option (a leading "-") */
export const ffPath = (p: string) => `file:${p}`;

/** the safety options every run starts with; the protocol whitelist is a per-input option, so it goes before each -i */
const SAFE = ['-hide_banner', '-nostdin'];
const WHITELIST = ['-protocol_whitelist', 'file,pipe'];
const guarded = (args: string[]) => [...SAFE, ...args.filter((a) => a !== '-hide_banner' && a !== '-nostdin').flatMap((a) => (a === '-i' ? [...WHITELIST, a] : [a]))];

export interface FfmpegRun {
  /** seconds of output ffmpeg is going to write, for progress */
  duration?: number;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

/** Runs ffmpeg; rejects with the tail of its log when it fails */
export function runFfmpeg(args: string[], { duration, signal, onProgress }: FfmpegRun = {}): Promise<string> {
  const bin = requireFfmpeg();
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const child = spawn(bin, guarded(args), { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let log = '';
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      log = (log + chunk).slice(-64_000);
      if (duration && onProgress) {
        const t = parseFfmpegTime(chunk.slice(chunk.lastIndexOf('time=')));
        if (t !== null) onProgress(Math.min(1, t / duration));
      }
    });
    child.on('error', (e) => reject(new RounderError('missing-dependency', `ffmpeg couldn't start (${e.message}).`, { hint: FFMPEG_HINT })));
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(abortError());
      if (code === 0) return resolve(log);
      const tail = log.trim().split('\n').slice(-4).join(' ').trim();
      if (/Invalid data found|could not find codec parameters|moov atom not found/i.test(log)) reject(new RounderError('damaged', "ffmpeg couldn't read this file. It may be damaged or not a media file.", { hint: tail }));
      else if (/Unknown encoder|Encoder not found/i.test(log)) reject(new RounderError('unsupported-codec', "Your ffmpeg build doesn't include the encoder this needs.", { hint: tail }));
      else reject(new RounderError('failed', `ffmpeg failed: ${tail || `exit code ${code}`}`));
    });
  });
}

/** Streams, codecs and duration, from the summary `ffmpeg -i` prints */
export async function probe(path: string, sizeBytes: number): Promise<MediaInfo> {
  const bin = requireFfmpeg();
  const r = spawnSync(bin, guarded(['-i', ffPath(path)]), { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const info = parseFfmpegProbe(r.stderr ?? '', sizeBytes);
  if (!info || (!info.video && !info.audio)) throw new RounderError('unsupported-input', "This file doesn't look like a video or audio file ffmpeg can read.");
  return info;
}

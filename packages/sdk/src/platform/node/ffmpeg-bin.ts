import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { RounderError } from '../../core/errors';

/*
 * Media runs on the user's own ffmpeg, as a separate program with an argument array (never a shell string). Nothing of
 * ffmpeg is shipped or linked. Found via ROUNDERTOOLS_FFMPEG, then PATH.
 */

export const FFMPEG_HINT = 'Install ffmpeg (https://ffmpeg.org/download.html) or set ROUNDERTOOLS_FFMPEG to its path.';

let found: string | null | undefined;

// under Node's permission model a folder outside the granted ones throws instead of answering, which means not here
const exists = (p: string) => {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
};

export function findFfmpeg(): string | null {
  if (found !== undefined) return found;
  const env = process.env.ROUNDERTOOLS_FFMPEG;
  if (env) return (found = isAbsolute(env) && exists(env) ? env : null);
  const names = process.platform === 'win32' ? ['ffmpeg.exe'] : ['ffmpeg'];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const n of names) {
      const p = join(dir.replace(/^"|"$/g, ''), n);
      if (dir && exists(p)) return (found = p);
    }
  }
  return (found = null);
}

export function requireFfmpeg(): string {
  const bin = findFfmpeg();
  if (!bin) throw new RounderError('missing-dependency', "This tool needs ffmpeg, and it wasn't found.", { hint: FFMPEG_HINT });
  return bin;
}

/** "8.1.2" or null */
export function ffmpegVersion(): string | null {
  const bin = findFfmpeg();
  if (!bin) return null;
  const r = spawnSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true });
  return /ffmpeg version (\S+)/.exec(r.stdout ?? '')?.[1] ?? null;
}


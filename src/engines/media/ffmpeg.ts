import type { FFFSType, FFmpeg, LogEvent } from '@ffmpeg/ffmpeg';
import { buildNormalizeArgs, buildTranscodeArgs, parseFfmpegProbe, parseFfmpegTime } from './ffargs';
import { planVideoSize } from './math';
import { containers, isAudioContainer, MediaError, type JobControl, type MediaInfo, type TranscodeOptions, type TranscodeResult } from './types';

/*
 * ffmpeg.wasm fallback for files WebCodecs can't handle (AVI, WMV, FLV, odd codecs) and
 * for browsers without WebCodecs. Single-threaded core: no SharedArrayBuffer, so no
 * COOP/COEP headers needed. The ~31 MB core is fetched only on first use, in parts
 * (hosting caps files at 25 MB), checked against its SHA-256 and joined into a blob URL.
 * Runs on the main thread's side: @ffmpeg/ffmpeg spawns its own worker.
 */

const BASE = '/vendor/ffmpeg/';

interface Manifest {
  version: string;
  bytes: number;
  sha256: string;
  parts: { name: string; bytes: number }[];
}

let assets: Promise<{ coreURL: string; wasmURL: string }> | null = null;
let instance: Promise<FFmpeg> | null = null;
const downloadListeners = new Set<(p: number) => void>();

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function fetchAssets() {
  const manifest: Manifest = await fetch(BASE + 'manifest.json').then((r) => {
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    return r.json();
  });
  const joined = new Uint8Array(manifest.bytes);
  let received = 0;
  let offset = 0;
  const offsets = manifest.parts.map((p) => ((offset += p.bytes), offset - p.bytes));
  await Promise.all(
    manifest.parts.map(async (part, i) => {
      const res = await fetch(BASE + part.name);
      if (!res.ok || !res.body) throw new Error(`${part.name} ${res.status}`);
      const reader = res.body.getReader();
      let at = offsets[i];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        joined.set(value, at);
        at += value.length;
        received += value.length;
        downloadListeners.forEach((fn) => fn(received / manifest.bytes));
      }
    }),
  );
  const digest = hex(await crypto.subtle.digest('SHA-256', joined));
  if (digest !== manifest.sha256) throw new Error('ffmpeg core failed its integrity check');
  const core = await fetch(BASE + 'ffmpeg-core.js').then((r) => r.blob());
  return {
    coreURL: URL.createObjectURL(new Blob([core], { type: 'text/javascript' })),
    wasmURL: URL.createObjectURL(new Blob([joined], { type: 'application/wasm' })),
  };
}

/** Downloads (first time only) and boots ffmpeg.wasm. `onProgress` reports the download, 0–1. */
export function loadFfmpeg(onProgress?: (p: number) => void): Promise<FFmpeg> {
  if (onProgress) downloadListeners.add(onProgress);
  instance ??= (async () => {
    // the joined wasm stays as a blob URL, so a reload after cancelling skips the download
    const urls = await (assets ??= fetchAssets().catch((e) => {
      assets = null;
      throw e;
    }));
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ff = new FFmpeg();
    // the class worker is served from /vendor so no bundler has to resolve it
    await ff.load({ ...urls, classWorkerURL: new URL(BASE + 'worker.js', location.href).href });
    return ff;
  })().catch((e) => {
    instance = null;
    throw new MediaError('ffmpeg-failed', `Couldn't load the fallback decoder (${e instanceof Error ? e.message : e}). Check your connection and try again.`, { cause: e });
  });
  return instance.finally(() => onProgress && downloadListeners.delete(onProgress));
}

export const ffmpegLoaded = () => instance !== null;

let queue: Promise<unknown> = Promise.resolve();
let jobId = 0;

/** ffmpeg runs one command at a time; jobs queue up behind each other */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

interface RunResult {
  code: number;
  log: string;
  output: Uint8Array | null;
}

/**
 * Mounts the inputs read-only (WORKERFS: no copy into wasm memory), runs one command and
 * reads back `outputPath`. Progress comes from ffmpeg's "time=" log lines.
 */
async function runFfmpeg(
  inputs: Blob[],
  makeArgs: (paths: string[]) => { args: string[]; output: string | null },
  ctl: JobControl & { durationSec?: number; download?: (p: number) => void } = {},
): Promise<RunResult> {
  if (ctl.signal?.aborted) throw new MediaError('aborted', 'Cancelled.');
  await loadFfmpeg(ctl.download);
  return serial(async () => {
    if (ctl.signal?.aborted) throw new MediaError('aborted', 'Cancelled.');
    // loaded again inside the queue: a job ahead of this one may have crashed or been cancelled
    const ff = await loadFfmpeg();
    const dir = `/in${++jobId}`;
    const names = inputs.map((b, i) => `input${i}${/\.[a-z0-9]{1,5}$/i.exec((b as File).name ?? '')?.[0] ?? ''}`);
    const { args, output } = makeArgs(names.map((n) => `${dir}/${n}`));
    await ff.createDir(dir);
    await ff.createDir('/out').catch(() => {});
    await ff.mount('WORKERFS' as FFFSType, { blobs: inputs.map((data, i) => ({ name: names[i], data })) }, dir);
    const lines: string[] = [];
    const onLog = ({ message }: LogEvent) => {
      lines.push(message);
      const t = parseFfmpegTime(message);
      if (t !== null && ctl.durationSec) ctl.onProgress?.(Math.min(1, t / ctl.durationSec));
    };
    ff.on('log', onLog);
    // the wasm can't be interrupted mid-command; terminating the worker is the only way out
    const abort = () => {
      ff.terminate();
      instance = null;
    };
    ctl.signal?.addEventListener('abort', abort);
    let crashed = false;
    try {
      const code = await ff.exec(args);
      const data = output && code === 0 ? ((await ff.readFile(output)) as Uint8Array) : null;
      if (output) await ff.deleteFile(output).catch(() => {});
      return { code, log: lines.join('\n'), output: data };
    } catch (e) {
      if (ctl.signal?.aborted) throw new MediaError('aborted', 'Cancelled.');
      // a wasm trap (e.g. "memory access out of bounds") leaves the instance unusable: drop it
      crashed = true;
      abort();
      throw new MediaError('ffmpeg-failed', 'The fallback decoder crashed on this file.', { cause: e });
    } finally {
      ctl.signal?.removeEventListener('abort', abort);
      if (!ctl.signal?.aborted && !crashed) {
        ff.off('log', onLog);
        await ff.unmount(dir).catch(() => {});
        await ff.deleteDir(dir).catch(() => {});
      }
    }
  }).catch((e) => {
    throw e instanceof MediaError ? e : new MediaError('ffmpeg-failed', 'The fallback decoder could not read this file.', { cause: e });
  });
}

function failure(log: string): MediaError {
  const tail = log.split('\n').filter((l) => /error|invalid|unsupported|not found|could not/i.test(l)).slice(-2).join(' ');
  return new MediaError('ffmpeg-failed', tail ? `The fallback decoder failed: ${tail}` : 'The fallback decoder could not process this file.');
}

/** Stream summary from `ffmpeg -i`, for files mediabunny can't open */
export async function ffmpegProbe(file: Blob, ctl: JobControl & { download?: (p: number) => void } = {}): Promise<MediaInfo | null> {
  const { log } = await runFfmpeg([file], ([input]) => ({ args: ['-hide_banner', '-i', input], output: null }), ctl);
  return parseFfmpegProbe(log, file.size);
}

/**
 * Rewrites a file into Matroska that WebCodecs can decode (stream copy when possible).
 * `offset` is where the result starts in the original timeline (non-zero when trimmed).
 */
export async function ffmpegNormalize(
  file: Blob,
  info: MediaInfo,
  o: { start?: number; end?: number; reencodeVideo?: boolean },
  ctl: JobControl & { download?: (p: number) => void } = {},
): Promise<{ blob: Blob; offset: number }> {
  let offset = 0;
  const { code, log, output } = await runFfmpeg(
    [file],
    ([input]) => {
      const job = buildNormalizeArgs(input, {
        copyVideo: !o.reencodeVideo,
        start: o.start,
        end: o.end,
        durationSec: info.durationSec,
        hasVideo: !!info.video,
        hasAudio: !!info.audio,
      });
      offset = job.offset;
      return job;
    },
    { ...ctl, durationSec: Math.max(0.1, (o.end ?? info.durationSec) - (o.start ?? 0)) },
  );
  if (code !== 0 || !output) throw failure(log);
  return { blob: new Blob([output as Uint8Array<ArrayBuffer>], { type: 'video/x-matroska' }), offset };
}

/** Whole job in ffmpeg — for browsers with no WebCodecs. Hooks aren't supported here. */
export async function ffmpegTranscode(
  file: Blob,
  o: TranscodeOptions,
  info: MediaInfo,
  ctl: JobControl & { download?: (p: number) => void } = {},
): Promise<TranscodeResult> {
  const c = containers[o.container];
  const replace = o.audio ? o.audio.replace : undefined;
  let notes: string[] = [];
  const start = o.trim?.start ?? 0;
  const end = Math.min(o.trim?.end ?? info.durationSec, info.durationSec);
  const speed = (o.video && o.video.speed) || 1;
  const { code, log, output } = await runFfmpeg(
    replace ? [file, replace] : [file],
    ([input, rep]) => {
      const job = buildTranscodeArgs(o, info, input, rep);
      notes = job.notes;
      return job;
    },
    { ...ctl, durationSec: (end - start) / speed },
  );
  if (code !== 0 || !output) throw failure(log);
  const size = info.video && o.video !== false && !isAudioContainer(o.container) ? planVideoSize(info.video.displayWidth, info.video.displayHeight, o.video ?? {}) : null;
  return {
    blob: new Blob([output as Uint8Array<ArrayBuffer>], { type: c.mime }),
    container: o.container,
    mimeWithCodecs: c.mime,
    width: size?.width,
    height: size?.height,
    durationSec: (end - start) / speed,
    notes: [...notes, 'Processed with the ffmpeg fallback.'],
    via: 'ffmpeg',
  };
}

/** Any audio ffmpeg can read → 32-bit float WAV bytes */
export async function ffmpegToWav(file: Blob, o: { start?: number; end?: number } = {}, ctl: JobControl & { download?: (p: number) => void } = {}): Promise<ArrayBuffer> {
  const { code, log, output } = await runFfmpeg(
    [file],
    ([input]) => ({
      args: [
        '-hide_banner',
        ...(o.start ? ['-ss', o.start.toFixed(3)] : []),
        '-i',
        input,
        ...(o.end ? ['-t', (o.end - (o.start ?? 0)).toFixed(3)] : []),
        '-vn',
        '-c:a',
        'pcm_f32le',
        '/out/audio.wav',
      ],
      output: '/out/audio.wav',
    }),
    ctl,
  );
  if (code !== 0 || !output) throw failure(log);
  return output.slice().buffer as ArrayBuffer;
}

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname } from 'node:path';
import { buildTranscodeArgs } from '@/engines/media/ffargs';
import { parseTime } from '@/engines/media/math';
import { containers, type Container, type MediaInfo, type QualityLevel, type TranscodeOptions } from '@/engines/media/types';
import { planCompression, retryAimMB, MB, type Settings } from '@/tools/lib/video-compressor/plan';
import { gifRepeat } from '@/tools/lib/video-to-gif/plan';
import { RounderError } from '../core/errors';
import { withSuffix, type Source } from '../core/io';
import type { OptionsOut } from '../core/op';
import { FileOutput, tempPath } from '../core/output';
import { result, type Ctx, type OpResult } from '../core/run';
import { formatSize, parseSize } from '../core/size';
import type * as ops from '../ops/media';
import { encoders, ffPath, probe, runFfmpeg } from '../platform/node/ffmpeg';

/** media never goes through memory: ffmpeg reads the path; bytes given in memory are written to a temp file first */
async function pathOf(src: Source): Promise<string> {
  if (src.path) return src.path;
  const p = tempPath(tmpdir(), extname(src.name).slice(1) || 'bin');
  await writeFile(p, await src.bytes());
  return p;
}

async function probeSource(src: Source): Promise<{ path: string; info: MediaInfo }> {
  const path = await pathOf(src);
  return { path, info: await probe(path, src.size) };
}

/** swaps encoders this ffmpeg build lacks for ones it has, or says which one is missing */
function fitEncoders(args: string[]): { args: string[]; notes: string[] } {
  const have = encoders();
  const notes: string[] = [];
  const out = [...args];
  const swap = (want: string, alternatives: string[], label: string) => {
    const i = out.indexOf(want);
    if (i < 0 || have.has(want)) return;
    const alt = alternatives.find((a) => have.has(a));
    if (!alt) throw new RounderError('unsupported-codec', `Your ffmpeg build has no ${label} encoder (${want}).`, { hint: 'Install a full ffmpeg build, e.g. from https://ffmpeg.org/download.html' });
    out[i] = alt;
    // x264's options don't apply to the stand-in
    if (want === 'libx264' && out[i + 1] === '-preset') out.splice(i + 1, 2);
    notes.push(`Your ffmpeg has no ${want}; used ${alt} instead.`);
  };
  swap('libx264', ['libopenh264', 'h264_videotoolbox', 'h264_mf', 'mpeg4'], 'H.264');
  swap('libmp3lame', ['libshine'], 'MP3');
  swap('libvpx', ['libvpx-vp9'], 'VP8');
  swap('libvorbis', ['vorbis'], 'Vorbis');
  return { args: out, notes };
}

/** runs the site's own command line (ffargs.buildTranscodeArgs) on the user's ffmpeg, into a temp file */
async function transcode(path: string, info: MediaInfo, options: TranscodeOptions, ctx: Ctx) {
  const job = buildTranscodeArgs(options, info, ffPath(path));
  const ext = containers[options.container].ext;
  const outFile = tempPath(tmpdir(), ext);
  job.args[job.args.length - 1] = ffPath(outFile);
  const { args, notes } = fitEncoders(job.args);
  const start = options.trim?.start ?? 0;
  const end = options.trim?.end ?? info.durationSec;
  const speed = options.video && options.video.speed ? options.video.speed : 1;
  await runFfmpeg(args, { duration: Math.max(0.1, (end - start) / speed), signal: ctx.signal, onProgress: (ratio) => ctx.progress({ stage: 'encoding', ratio }) });
  return { file: outFile, notes: [...job.notes, ...notes] };
}

const mediaOut = (name: string, container: Container, file: string, meta: Record<string, unknown>, warnings: string[] = []) =>
  new FileOutput({ name, mime: containers[container].mime, file, meta, warnings });

const QUALITY: Record<string, QualityLevel> = { high: 'high', medium: 'medium', low: 'low' };

/** the input's own container when ffmpeg can write it back, else MP4 */
function sameContainer(name: string, info: MediaInfo): Container {
  const ext = extname(name).slice(1).toLowerCase();
  if (ext in containers && (info.video ? containers[ext as Container].video.length > 0 : true)) return ext as Container;
  return info.video ? 'mp4' : 'm4a';
}

function seconds(v: number | string | undefined, label: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  const s = parseTime(v);
  if (s === null) throw new RounderError('invalid-options', `${label} "${v}" isn't a time. Use seconds or a time like 1:05.`);
  return s;
}

export async function compress(inputs: Source[], o: OptionsOut<typeof ops.videoCompressor>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const { path, info } = await probeSource(src);
  if (!info.video) throw new RounderError('unsupported-input', "This file has no video track. Use audio-converter for audio files.");
  const target = o.target !== undefined ? parseSize(o.target) : undefined;
  const settings: Settings = { mode: target ? 'target' : 'quality', targetMB: (target ?? 0) / MB, preset: o.quality, resolution: o.resolution, fps: o.fps, codec: 'avc', removeAudio: o.removeAudio };
  const plan = planCompression(info, settings);
  const name = withSuffix(src.name, '-compressed', plan.container);
  if (plan.skip === 'fits') {
    const warnings = [`It's already under ${formatSize(target!)}, so the result is the original file.`];
    return result({ files: [new FileOutput({ name: withSuffix(src.name, '-compressed'), mime: 'video/mp4', file: path, owned: false, meta: { kept: true, fits: true }, warnings })], warnings });
  }
  const warnings: string[] = [];
  let r = await transcode(path, info, plan.options, ctx);
  let size = new FileOutput({ name, mime: '', file: r.file }).size;
  // x264 at an average bitrate can overshoot on busy footage: one more pass aims lower, as the site does
  if (target && size > target) {
    const aim = retryAimMB(target / MB, target / MB, size);
    const retry = planCompression(info, { ...settings, targetMB: aim });
    await new FileOutput({ name, mime: '', file: r.file }).dispose();
    r = await transcode(path, info, retry.options, ctx);
    size = new FileOutput({ name, mime: '', file: r.file }).size;
  }
  const fits = target ? size <= target : undefined;
  if (target && !fits) warnings.push(`It came out at ${formatSize(size)}, over ${formatSize(target)}. Trim the clip, remove the audio or pick a lower resolution.`);
  if (!plan.feasible) warnings.push('The target leaves very little room for this much video, so quality will be low.');
  warnings.push(...r.notes);
  return result({ files: [mediaOut(name, plan.container, r.file, { width: plan.width, height: plan.height, videoBitrate: plan.videoBitrate, audioBitrate: plan.audioBitrate, fits, target }, warnings)], warnings });
}

export async function convert(inputs: Source[], o: OptionsOut<typeof ops.videoConverter>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const { path, info } = await probeSource(src);
  const audioOnly = containers[o.to].video.length === 0;
  if (!info.video && !audioOnly) throw new RounderError('unsupported-input', 'This file has no video track. Convert it to mp3, m4a or wav instead.');
  const q = QUALITY[o.quality];
  const r = await transcode(path, info, { container: o.to, video: audioOnly ? false : { quality: q }, audio: { quality: q } }, ctx);
  return result({ files: [mediaOut(withSuffix(src.name, '', containers[o.to].ext), o.to, r.file, { container: o.to }, r.notes)], warnings: r.notes });
}

export async function trim(inputs: Source[], o: OptionsOut<typeof ops.trimVideo>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const { path, info } = await probeSource(src);
  const start = seconds(o.start, 'start') ?? 0;
  const end = Math.min(seconds(o.end, 'end') ?? info.durationSec, info.durationSec || Infinity);
  if (!(end > start)) throw new RounderError('invalid-options', `The end (${end}s) must come after the start (${start}s).`);
  const container = sameContainer(src.name, info);
  const name = withSuffix(src.name, '-trimmed', containers[container].ext);
  if (o.copy) {
    const file = tempPath(tmpdir(), containers[container].ext);
    await runFfmpeg(['-ss', start.toFixed(3), '-i', ffPath(path), '-t', (end - start).toFixed(3), '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', ffPath(file)], { duration: end - start, signal: ctx.signal, onProgress: (ratio) => ctx.progress({ stage: 'copying', ratio }) });
    const warnings = ['Cut without re-encoding, so it starts on the keyframe nearest the start time.'];
    return result({ files: [mediaOut(name, container, file, { start, end, copied: true }, warnings)], warnings });
  }
  const r = await transcode(path, info, { container, trim: { start, end }, video: info.video ? { quality: 'high' } : false, audio: { quality: 'high' } }, ctx);
  return result({ files: [mediaOut(name, container, r.file, { start, end }, r.notes)], warnings: r.notes });
}

export async function mute(inputs: Source[], _o: OptionsOut<typeof ops.muteVideo>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const { path, info } = await probeSource(src);
  if (!info.video) throw new RounderError('unsupported-input', 'This file has no video track.');
  const container = sameContainer(src.name, info);
  const file = tempPath(tmpdir(), containers[container].ext);
  await runFfmpeg(['-i', ffPath(path), '-map', '0:v', '-c', 'copy', '-an', ffPath(file)], { duration: info.durationSec, signal: ctx.signal, onProgress: (ratio) => ctx.progress({ stage: 'copying', ratio }) });
  const warnings = info.audio ? [] : ['This video had no sound to begin with.'];
  return result({ files: [mediaOut(withSuffix(src.name, '-muted', containers[container].ext), container, file, { hadAudio: !!info.audio }, warnings)], warnings });
}

export async function toGif(inputs: Source[], o: OptionsOut<typeof ops.videoToGif>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const { path, info } = await probeSource(src);
  if (!info.video) throw new RounderError('unsupported-input', 'This file has no video track.');
  const start = seconds(o.start, 'start') ?? 0;
  const end = Math.min(seconds(o.end, 'end') ?? start + 5, info.durationSec || Infinity);
  if (!(end > start)) throw new RounderError('invalid-options', `The end (${end}s) must come after the start (${start}s).`);
  const width = Math.min(o.width, info.video.displayWidth);
  const file = tempPath(tmpdir(), 'gif');
  // one palette per clip, like the site's encoder, so colors don't band
  const filter = `fps=${o.fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`;
  await runFfmpeg(['-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', ffPath(path), '-filter_complex', filter, '-loop', String(gifRepeat(o.loop)), ffPath(file)], {
    duration: end - start,
    signal: ctx.signal,
    onProgress: (ratio) => ctx.progress({ stage: 'encoding', ratio }),
  });
  const warnings = end - start > 15 ? ['GIFs longer than about 15 seconds get very big; an MP4 loop is far smaller.'] : [];
  return result({ files: [new FileOutput({ name: withSuffix(src.name, '', 'gif'), mime: 'image/gif', file, meta: { start, end, width, fps: o.fps }, warnings })], warnings });
}

async function audioOut(src: Source, to: 'mp3' | 'm4a' | 'ogg' | 'wav' | 'flac', kbps: number | undefined, ctx: Ctx): Promise<OpResult> {
  const { path, info } = await probeSource(src);
  if (!info.audio) throw new RounderError('unsupported-input', 'This file has no audio track.');
  const lossless = to === 'wav' || to === 'flac';
  const r = await transcode(path, info, { container: to, video: false, audio: lossless ? {} : { bitrate: (kbps ?? 192) * 1000 } }, ctx);
  return result({ files: [mediaOut(withSuffix(src.name, '', containers[to].ext), to, r.file, { durationSec: info.durationSec, bitrate: lossless ? undefined : (kbps ?? 192) * 1000 }, r.notes)], warnings: r.notes });
}

export const toAudio = (inputs: Source[], o: OptionsOut<typeof ops.videoToMp3>, ctx: Ctx) => audioOut(inputs[0], o.format, o.bitrate, ctx);
export const convertAudio = (inputs: Source[], o: OptionsOut<typeof ops.audioConverter>, ctx: Ctx) => audioOut(inputs[0], o.to, o.bitrate, ctx);

export async function info(src: Source) {
  const { info } = await probeSource(src);
  return { kind: info.video ? 'video' : 'audio', container: info.container, durationSec: info.durationSec, video: info.video && { codec: info.video.codec, width: info.video.displayWidth, height: info.video.displayHeight, fps: info.video.fps, bitrate: info.video.bitrate, rotation: info.video.rotation }, audio: info.audio && { codec: info.audio.codec, sampleRate: info.audio.sampleRate, channels: info.audio.channels, bitrate: info.audio.bitrate } };
}

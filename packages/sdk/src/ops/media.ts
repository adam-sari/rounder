import { z } from 'zod';
import { defineOp } from '../core/op';
import { size } from '../core/size';

const VIDEO = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', '3gp', 'wmv', 'flv', 'mpg', 'mpeg', 'ts'];
const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif'];
/** seconds, or a clock time like "1:05" or "00:01:05.5" */
const time = z.union([z.number().min(0), z.string().regex(/^(\d+:){0,2}\d+(\.\d+)?$/)]);

export const videoCompressor = defineOp({
  slug: 'video-compressor',
  family: 'media',
  fn: 'compress',
  title: 'Video compressor',
  summary: 'Shrink a video to a size target (like 25mb for Discord or email) or by a quality preset.',
  inputs: { accept: VIDEO, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-compressed',
  requires: ['ffmpeg'],
  options: z.object({
    target: size().optional().describe('Size limit, like "25mb" (switches to target mode)'),
    quality: z.enum(['high', 'balanced', 'small']).default('balanced').describe('Preset when there is no target'),
    resolution: z.union([z.enum(['auto', 'original']), z.literal(1080), z.literal(720), z.literal(480)]).default('auto').describe('Short-side cap; auto picks one for the target'),
    fps: z.union([z.literal('original'), z.literal(30), z.literal(24)]).default('original'),
    removeAudio: z.boolean().default(false),
  }),
  short: { target: 't' },
  examples: [{ inputs: ['clip.mov'], options: { target: '25mb' }, prompt: 'Compress clip.mov under 25 MB so I can email it' }],
  presets: (p) => (typeof p.targetMB === 'number' ? { target: `${p.targetMB}mb` } : null),
});

export const videoConverter = defineOp({
  slug: 'video-converter',
  family: 'media',
  fn: 'convert',
  title: 'Video converter',
  summary: 'Convert videos to MP4, WebM, MOV or MKV, or pull the sound out as MP3, M4A or WAV.',
  inputs: { accept: VIDEO, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  requires: ['ffmpeg'],
  options: z.object({
    to: z.enum(['mp4', 'webm', 'mov', 'mkv', 'mp3', 'm4a', 'wav']).default('mp4'),
    quality: z.enum(['high', 'medium', 'low']).default('high'),
  }),
  examples: [{ inputs: ['screen.webm'], options: { to: 'mp4' }, prompt: 'Convert screen.webm to MP4' }],
  presets: (p) => (typeof p.to === 'string' && ['mp4', 'webm', 'mov', 'mkv'].includes(p.to) ? { to: p.to as 'mp4' } : null),
});

export const trimVideo = defineOp({
  slug: 'trim-video',
  family: 'media',
  fn: 'trim',
  title: 'Trim video',
  summary: 'Cut a video down to the part between two times.',
  inputs: { accept: [...VIDEO, ...AUDIO], min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-trimmed',
  requires: ['ffmpeg'],
  options: z.object({
    start: time.default(0).describe('Seconds or a time like 1:05'),
    end: time.optional().describe('Seconds or a time like 2:30 (default: the end)'),
    copy: z.boolean().default(false).describe('Cut without re-encoding: instant, but starts on the nearest keyframe'),
  }),
  examples: [{ inputs: ['talk.mp4'], options: { start: '1:05', end: '2:30' }, prompt: 'Trim talk.mp4 to 1:05–2:30' }],
});

export const muteVideo = defineOp({
  slug: 'mute-video',
  family: 'media',
  fn: 'mute',
  title: 'Mute video',
  summary: 'Remove the sound from a video, without re-encoding the picture.',
  inputs: { accept: VIDEO, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  suffix: '-muted',
  requires: ['ffmpeg'],
  options: z.object({}),
  examples: [{ inputs: ['clip.mp4'], prompt: 'Remove the audio from clip.mp4' }],
});

export const videoToGif = defineOp({
  slug: 'video-to-gif',
  family: 'media',
  fn: 'toGif',
  title: 'Video to GIF',
  summary: 'Turn a video clip into an animated GIF with a per-clip palette.',
  inputs: { accept: VIDEO, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  requires: ['ffmpeg'],
  options: z.object({
    start: time.default(0),
    end: time.optional().describe('Default: 5 seconds after start'),
    width: z.number().int().min(64).max(1600).default(480),
    fps: z.number().int().min(1).max(30).default(12),
    loop: z.number().int().min(0).max(100).default(0).describe('Times to play; 0 loops forever'),
  }),
  examples: [{ inputs: ['funny.mp4'], options: { start: 3, end: 6 }, prompt: 'Make a GIF of seconds 3 to 6 of funny.mp4' }],
});

export const videoToMp3 = defineOp({
  slug: 'video-to-mp3',
  family: 'media',
  fn: 'toAudio',
  title: 'Video to MP3',
  summary: 'Save the soundtrack of a video as MP3, M4A, OGG, WAV or FLAC.',
  inputs: { accept: VIDEO, min: 1, max: 1, mode: 'each' },
  returns: 'file',
  requires: ['ffmpeg'],
  options: z.object({
    format: z.enum(['mp3', 'm4a', 'ogg', 'wav', 'flac']).default('mp3'),
    bitrate: z.number().int().min(32).max(320).default(192).describe('kbps, for MP3, M4A and OGG'),
  }),
  examples: [{ inputs: ['lecture.mp4'], prompt: 'Extract the audio of lecture.mp4 as an MP3' }],
});

export const audioConverter = defineOp({
  slug: 'audio-converter',
  family: 'media',
  fn: 'convertAudio',
  title: 'Audio converter',
  summary: 'Convert audio between MP3, M4A, WAV, OGG and FLAC.',
  inputs: { accept: [...AUDIO, ...VIDEO], min: 1, max: 1, mode: 'each' },
  returns: 'file',
  requires: ['ffmpeg'],
  options: z.object({
    to: z.enum(['mp3', 'm4a', 'wav', 'ogg', 'flac']).default('mp3'),
    bitrate: z.number().int().min(32).max(320).optional().describe('kbps for MP3, M4A and OGG (default 192)'),
  }),
  examples: [{ inputs: ['memo.m4a'], options: { to: 'mp3' }, prompt: 'Convert memo.m4a to MP3' }],
  presets: (p) => (typeof p.to === 'string' && ['mp3', 'm4a', 'wav', 'ogg', 'flac'].includes(p.to) ? { to: p.to as 'mp3' } : null),
});

export const mediaOps = [videoCompressor, videoConverter, trimVideo, muteVideo, videoToGif, videoToMp3, audioConverter];

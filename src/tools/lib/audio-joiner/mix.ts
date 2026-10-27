import { mixdown } from '@/engines/media/dsp';

/*
 * Joining plan and mixing for the audio joiner. Times are in seconds until framePlan()
 * turns them into sample frames; tracks are mixed into one preallocated buffer one at a time,
 * so only the current track's decoded audio is held next to the output.
 */

export type TransitionKind = 'none' | 'crossfade' | 'gap';

export interface Transition {
  kind: TransitionKind;
  /** crossfade length or silence between tracks */
  seconds: number;
}

export interface JoinPlan {
  /** where each track starts in the output */
  offsets: number[];
  /** overlap between track i and i + 1 (crossfades only) */
  overlaps: number[];
  total: number;
}

/**
 * Lays tracks end to end. A crossfade is capped at half of either neighbour, so a short
 * clip is never overlapped from both sides by more than its own length.
 */
export function planJoin(lengths: number[], t: Transition): JoinPlan {
  const offsets: number[] = [];
  const overlaps: number[] = [];
  const amount = Math.max(0, t.seconds);
  let cursor = 0;
  lengths.forEach((len, i) => {
    if (i > 0) {
      const overlap = t.kind === 'crossfade' ? Math.min(amount, lengths[i - 1] / 2, len / 2) : 0;
      overlaps.push(overlap);
      cursor += t.kind === 'gap' ? amount : -overlap;
    }
    offsets.push(cursor);
    cursor += len;
  });
  return { offsets, overlaps, total: Math.max(0, cursor) };
}

export interface TrackFrames {
  offset: number;
  length: number;
  fadeIn: number;
  fadeOut: number;
}

/** the plan in whole frames at `sampleRate` */
export function framePlan(plan: JoinPlan, lengths: number[], sampleRate: number): { tracks: TrackFrames[]; total: number } {
  const f = (sec: number) => Math.max(0, Math.round(sec * sampleRate));
  const tracks = lengths.map((len, i) => ({
    offset: f(plan.offsets[i]),
    length: f(len),
    fadeIn: i > 0 ? f(plan.overlaps[i - 1]) : 0,
    fadeOut: i < lengths.length - 1 ? f(plan.overlaps[i]) : 0,
  }));
  const total = tracks.reduce((m, t) => Math.max(m, t.offset + t.length), 0);
  return { tracks, total };
}

/** equal-power curves: fadeIn(t)² + fadeOut(t)² = 1, so a crossfade keeps the level steady */
export const fadeInGain = (t: number) => Math.sin((Math.PI / 2) * t);
export const fadeOutGain = (t: number) => Math.cos((Math.PI / 2) * t);

/** what the joined file uses: the highest sample rate (8–48 kHz) and stereo if any track is */
export function outputLayout(tracks: { sampleRate: number; channels: number }[]): { sampleRate: number; channels: 1 | 2 } {
  const rate = Math.max(8000, ...tracks.map((t) => t.sampleRate || 0));
  return { sampleRate: Math.min(48000, rate), channels: tracks.some((t) => t.channels > 1) ? 2 : 1 };
}

/**
 * Mono becomes centred stereo; anything over two channels (5.1 film audio) is folded to mono
 * first, because channel order differs between containers and a wrong guess swaps the sides.
 */
export function conformChannels(channels: Float32Array[], target: 1 | 2): Float32Array[] {
  if (channels.length === target) return channels;
  const mono = mixdown(channels);
  return target === 1 ? [mono] : [mono, mono];
}

/**
 * Adds one track into `out` at `p.offset`, with gain and equal-power fades over its first
 * `fadeIn` and last `fadeOut` frames. The source is cut or padded with silence to `p.length`,
 * since a decoder can return a few frames more or less than the probed duration.
 */
export function mixTrack(out: Float32Array[], src: Float32Array[], p: TrackFrames & { gain: number }) {
  const n = Math.max(0, Math.min(p.length, (out[0]?.length ?? 0) - p.offset));
  const have = Math.min(n, src[0]?.length ?? 0);
  const outStart = p.length - p.fadeOut;
  for (let c = 0; c < out.length; c++) {
    const o = out[c];
    const s = src[Math.min(c, src.length - 1)];
    for (let i = 0; i < have; i++) {
      let g = p.gain;
      if (i < p.fadeIn) g *= fadeInGain((i + 0.5) / p.fadeIn);
      if (i >= outStart) g *= fadeOutGain((i - outStart + 0.5) / p.fadeOut);
      o[p.offset + i] += s[i] * g;
    }
  }
}

/** bytes the float mix buffer needs, so the UI can warn before a huge job */
export const mixBytes = (seconds: number, sampleRate: number, channels: number) => Math.ceil(seconds * sampleRate) * channels * 4;

/** past this the mix buffer alone is over a gigabyte at 48 kHz stereo */
export const LONG_JOIN_SEC = 3600;

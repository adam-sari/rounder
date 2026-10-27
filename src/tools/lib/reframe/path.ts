import type { Box, Focus } from './signal';

/*
 * The crop path: where the vertical (or square) window sits over the source at every moment.
 * All positions are the window's centre in 0–1 frame units.
 *
 *   analysis samples (faces, focus) → a target per sample → median → dead zone (only re-aim
 *   when the subject leaves the zone) → critically damped spring run forwards and backwards
 *   (zero lag) on a 30 Hz grid → per-shot curves. Scene cuts split shots: the camera jumps
 *   at a cut instead of panning across it.
 *
 * Keyframes (the visitor's edits) sit on top: a "pin" keyframe takes over the framing from
 * itself onward (pins in a row pan between each other); a "track" keyframe hands back to the
 * automatic path. Hand-overs ease in over RAMP seconds. Keyframes never cross a cut.
 */

export interface Sample {
  t: number;
  faces: Box[];
  focus: Focus | null;
}

export interface Analysis {
  duration: number;
  samples: Sample[];
  /** times where a new shot starts (exact cut times) */
  cuts: number[];
}

/** what the automatic framing followed */
export type Kind = 'face' | 'motion' | 'center';

export interface Smoothing {
  /** seconds the spring takes to settle */
  smoothTime: number;
  /** re-aim only when the subject drifts this far, in window widths */
  deadZone: number;
  /** fastest pan, in window widths per second */
  maxSpeed: number;
}

export const SMOOTHING = {
  calm: { smoothTime: 0.8, deadZone: 0.18, maxSpeed: 0.6 },
  balanced: { smoothTime: 0.45, deadZone: 0.1, maxSpeed: 1.2 },
  snappy: { smoothTime: 0.25, deadZone: 0.04, maxSpeed: 2.5 },
} satisfies Record<string, Smoothing>;
export type SmoothingKey = keyof typeof SMOOTHING;

interface Shot {
  start: number;
  end: number;
  xs: Float32Array;
  ys: Float32Array;
}

export interface Path {
  /** window size in 0–1 frame units */
  cw: number;
  ch: number;
  step: number;
  shots: Shot[];
  /** per analysis sample, what the framing followed (for the timeline) */
  track: { t: number; kind: Kind }[];
}

export interface Keyframe {
  t: number;
  x: number;
  y: number;
  /** true: resume automatic tracking from here */
  track?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

const STEP = 1 / 30;
/** a face that blinks out for less than this keeps the framing */
const HOLD = 1;
/** seconds a hand-over between automatic and pinned framing takes */
export const RAMP = 0.5;
const MIN_FACE = 0.012;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const evenize = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const ease = (p: number) => p * p * (3 - 2 * p);

/** the biggest window of `aspect` (w/h) that fits a W × H frame, in whole pixels */
export function cropSize(W: number, H: number, aspect: number) {
  const width = Math.min(W, Math.round(H * aspect));
  return { width, height: Math.min(H, Math.round(width / aspect)) };
}

/** the exported frame: a standard size with `short` px on the short side (1080 → 1080 × 1920 for 9:16), or the window's own pixels */
export function outputSize(aspect: number, short: number, crop: { width: number; height: number }) {
  if (!short) return { width: evenize(crop.width), height: evenize(crop.height) };
  return aspect < 1 ? { width: short, height: evenize(short / aspect) } : { width: evenize(short * aspect), height: short };
}

/** keeps the window inside the frame */
export function clampCenter(p: Point, cw: number, ch: number): Point {
  return { x: clamp(p.x, cw / 2, 1 - cw / 2), y: clamp(p.y, ch / 2, 1 - ch / 2) };
}

/** the window in source pixels for a centre */
export function cropRect(p: Point, W: number, H: number, crop: { width: number; height: number }) {
  return {
    x: Math.round(clamp(p.x * W - crop.width / 2, 0, W - crop.width)),
    y: Math.round(clamp(p.y * H - crop.height / 2, 0, H - crop.height)),
    width: crop.width,
    height: crop.height,
  };
}

/**
 * Where to aim for these faces. Faces that fit in the window together are framed together;
 * otherwise the most prominent one wins, preferring the one already framed (no ping-pong
 * between two similar faces). Faces sit a little above centre, where eyes look natural.
 */
export function subjectTarget(faces: Box[], prevX: number | null, cw: number, ch: number): Point | null {
  const real = faces.filter((f) => f.w >= MIN_FACE);
  if (!real.length) return null;
  const weight = (f: Box) => f.w * f.h * (f.score ?? 1);
  const top = Math.max(...real.map(weight));
  const group = real.filter((f) => weight(f) >= 0.3 * top);
  const x0 = Math.min(...group.map((f) => f.x));
  const x1 = Math.max(...group.map((f) => f.x + f.w));
  let pick: Box;
  if (x1 - x0 <= cw * 0.85) {
    const y0 = Math.min(...group.map((f) => f.y));
    const y1 = Math.max(...group.map((f) => f.y + f.h));
    pick = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  } else {
    const strong = group.filter((f) => weight(f) >= 0.5 * top);
    const cx = (f: Box) => f.x + f.w / 2;
    pick = prevX === null ? strong.reduce((a, b) => (weight(b) > weight(a) ? b : a)) : strong.reduce((a, b) => (Math.abs(cx(b) - prevX) < Math.abs(cx(a) - prevX) ? b : a));
  }
  return { x: pick.x + pick.w / 2, y: pick.y + pick.h / 2 + 0.1 * ch };
}

/** Unity-style SmoothDamp: a critically damped spring with a speed limit */
export function smoothDamp(cur: number, target: number, vel: number, smoothTime: number, maxSpeed: number, dt: number): [number, number] {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * smoothTime;
  const change = clamp(cur - target, -maxChange, maxChange);
  const goal = cur - change;
  const temp = (vel + omega * change) * dt;
  let v = (vel - omega * temp) * exp;
  let out = goal + (change + temp) * exp;
  // never overshoot the real target
  if (target - cur > 0 === out > target) {
    out = target;
    v = 0;
  }
  return [out, v];
}

const median5 = (v: number[], i: number) => {
  const w = v.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b);
  return w[w.length >> 1];
};

/** median → dead zone (re-aim fully once the subject leaves it) */
function settle(raw: number[], deadZone: number): number[] {
  const m = raw.map((_, i) => median5(raw, i));
  let anchor = m[0];
  return m.map((v) => (Math.abs(v - anchor) > deadZone ? (anchor = v) : anchor));
}

/** spring the per-sample aims onto a 30 Hz grid, forwards and backwards, averaged: smooth and lag-free */
function spring(times: number[], aims: number[], start: number, n: number, s: Smoothing, size: number): Float32Array {
  // the nearest sample's aim at each grid point (times are sorted, so one pointer walks them)
  let i = 0;
  const grid = Array.from({ length: n }, (_, k) => {
    const t = start + k * STEP;
    while (i + 1 < times.length && times[i + 1] - t < t - times[i]) i++;
    return aims[i];
  });
  const run = (order: number[]) => {
    const out = new Float32Array(n);
    let pos = grid[order[0]];
    let vel = 0;
    for (const k of order) {
      [pos, vel] = smoothDamp(pos, grid[k], vel, s.smoothTime, s.maxSpeed * size, STEP);
      out[k] = pos;
    }
    return out;
  };
  const idx = Array.from({ length: n }, (_, k) => k);
  const fwd = run(idx);
  const back = run(idx.reverse());
  return fwd.map((v, k) => (v + back[k]) / 2);
}

/** Builds the automatic crop path for a window of cw × ch (0–1 frame units) */
export function buildPath(a: Analysis, cw: number, ch: number, s: Smoothing): Path {
  const starts = [0, ...a.cuts.filter((c) => c > 0 && c < a.duration)];
  const track: Path['track'] = [];
  const shots = starts.map((start, si): Shot => {
    const end = starts[si + 1] ?? a.duration;
    let samples = a.samples.filter((p) => p.t >= start && p.t < end);
    // a shot shorter than the sampling gap borrows the nearest sample
    if (!samples.length && a.samples.length) samples = [a.samples.reduce((p, q) => (Math.abs(q.t - start) < Math.abs(p.t - start) ? q : p))];

    let prevX: number | null = null;
    const faceAims = samples.map((p) => {
      const aim = subjectTarget(p.faces, prevX, cw, ch);
      if (aim) prevX = aim.x;
      return aim;
    });
    const aims = samples.map((p, i): Point & { kind: Kind } => {
      const face = faceAims[i] ?? nearestFace(samples, faceAims, i);
      if (face) return { ...face, kind: 'face' };
      if (p.focus) return { x: 0.5 + (p.focus.x - 0.5) * p.focus.weight, y: 0.5 + (p.focus.y - 0.5) * p.focus.weight, kind: 'motion' };
      return { x: 0.5, y: 0.5, kind: 'center' };
    });
    samples.forEach((p, i) => {
      if (p.t >= start && p.t < end) track.push({ t: p.t, kind: aims[i].kind });
    });

    const n = Math.max(1, Math.ceil((end - start) / STEP) + 1);
    if (!aims.length) return { start, end, xs: new Float32Array(n).fill(0.5), ys: new Float32Array(n).fill(0.5) };
    const clamped = aims.map((p) => clampCenter(p, cw, ch));
    const times = samples.map((p) => p.t);
    const axis = (key: 'x' | 'y', size: number) => spring(times, settle(clamped.map((p) => p[key]), s.deadZone * size), start, n, s, size);
    return { start, end, xs: axis('x', cw), ys: axis('y', ch) };
  });
  return { cw, ch, step: STEP, shots, track };
}

/** a face aim from a neighbouring sample within HOLD seconds (detectors blink) */
function nearestFace(samples: Sample[], aims: (Point | null)[], i: number): Point | null {
  for (let d = 1; d < samples.length; d++) {
    for (const j of [i - d, i + d]) {
      if (j < 0 || j >= samples.length) continue;
      if (Math.abs(samples[j].t - samples[i].t) > HOLD) return null;
      if (aims[j]) return aims[j];
    }
  }
  return null;
}

export function shotIndex(path: Path, t: number): number {
  let i = 0;
  while (i + 1 < path.shots.length && path.shots[i + 1].start <= t) i++;
  return i;
}

/** the automatic centre at time t */
export function autoAt(path: Path, t: number): Point {
  const shot = path.shots[shotIndex(path, t)];
  const f = clamp((t - shot.start) / path.step, 0, shot.xs.length - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, shot.xs.length - 1);
  const p = f - i;
  return { x: shot.xs[i] + (shot.xs[j] - shot.xs[i]) * p, y: shot.ys[i] + (shot.ys[j] - shot.ys[i]) * p };
}

/** keyframes in the same shot as t, sorted */
export function shotKeys(path: Path, keys: Keyframe[], t: number): Keyframe[] {
  const s = shotIndex(path, t);
  return keys.filter((k) => shotIndex(path, k.t) === s).sort((a, b) => a.t - b.t);
}

/** the pinned framing at t and how much it takes over (0 = automatic, 1 = pinned) */
export function manualAt(path: Path, keys: Keyframe[], t: number): { pos: Point | null; weight: number } {
  const ks = shotKeys(path, keys, t);
  const shotStart = path.shots[shotIndex(path, t)].start;
  let prev: Keyframe | undefined;
  let next: Keyframe | undefined;
  for (const k of ks) {
    if (k.t <= t) prev = k;
    else if (!next) next = k;
  }
  const pinned = (k?: Keyframe) => !!k && !k.track;
  let pos: Point | null = null;
  if (pinned(prev) && pinned(next)) {
    const p = ease((t - prev!.t) / (next!.t - prev!.t));
    pos = { x: prev!.x + (next!.x - prev!.x) * p, y: prev!.y + (next!.y - prev!.y) * p };
  } else if (pinned(prev)) pos = prev!;
  else if (pinned(next)) pos = next!;

  let weight = pinned(prev) ? 1 : 0;
  if (next && pinned(next) !== pinned(prev)) {
    const from = Math.max(prev?.t ?? shotStart, next.t - RAMP);
    if (t > from) {
      const p = ease(clamp((t - from) / Math.max(1e-6, next.t - from), 0, 1));
      weight = pinned(next) ? p : 1 - p;
    }
  }
  return { pos: pos && { x: pos.x, y: pos.y }, weight: pos ? weight : 0 };
}

/** the final centre at time t: automatic path blended with the visitor's keyframes */
export function centerAt(path: Path, keys: Keyframe[], t: number): Point {
  const auto = autoAt(path, t);
  const { pos, weight } = keys.length ? manualAt(path, keys, t) : { pos: null, weight: 0 };
  const p = pos ? { x: auto.x + (pos.x - auto.x) * weight, y: auto.y + (pos.y - auto.y) * weight } : auto;
  return clampCenter(p, path.cw, path.ch);
}

/** adds a keyframe, or moves the one within `snap` seconds in the same shot */
export function setKey(path: Path, keys: Keyframe[], key: Keyframe, snap = 0.15): Keyframe[] {
  const s = shotIndex(path, key.t);
  const near = keys.find((k) => Math.abs(k.t - key.t) <= snap && shotIndex(path, k.t) === s);
  const next = near ? keys.map((k) => (k === near ? { ...key, t: near.t } : k)) : [...keys, key];
  return next.sort((a, b) => a.t - b.t);
}

/** removes every keyframe in the shot at time t */
export function clearShot(path: Path, keys: Keyframe[], t: number): Keyframe[] {
  const s = shotIndex(path, t);
  return keys.filter((k) => shotIndex(path, k.t) !== s);
}

import { describe, expect, it } from 'vitest';
import tool from '@/tools/defs/auto-reframe-video';
import {
  autoAt,
  buildPath,
  centerAt,
  clampCenter,
  clearShot,
  cropRect,
  cropSize,
  manualAt,
  outputSize,
  RAMP,
  setKey,
  shotIndex,
  smoothDamp,
  SMOOTHING,
  subjectTarget,
  type Analysis,
  type Sample,
} from '@/tools/lib/reframe/path';
import { changeScore, findCuts, focusPoint, histDistance, histogram, lumaOf, mergeBoxes, refineCut, squareTiles } from '@/tools/lib/reframe/signal';

const W = 64;
const H = 36;
const flat = (v: number) => new Uint8Array(W * H).fill(v);
/** a bright square on a dark frame, centred at (cx, cy) in pixels */
function blob(cx: number, cy: number, r = 4, bg = 20) {
  const a = flat(bg);
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) a[y * W + x] = 230;
  return a;
}

/** 9:16 window over 16:9 footage */
const crop = cropSize(1920, 1080, 9 / 16);
const cw = crop.width / 1920;
const ch = crop.height / 1080;
const face = (cx: number, w = 0.08) => ({ x: cx - w / 2, y: 0.3, w, h: w * 1.6, score: 0.9 });

function analysis(duration: number, faceX: (t: number) => number | null, cuts: number[] = []): Analysis {
  const samples: Sample[] = [];
  for (let t = 0; t < duration; t += 0.2) {
    const x = faceX(t);
    samples.push({ t, faces: x === null ? [] : [face(x)], focus: null });
  }
  return { duration, samples, cuts };
}

describe('signal', () => {
  it('computes luma and normalised histograms', () => {
    expect([...lumaOf(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]))]).toEqual([255, 0]);
    const h = histogram(flat(100));
    expect(h.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(histDistance(histogram(flat(10)), histogram(flat(240)))).toBeCloseTo(1);
  });

  it('scores a hard cut far above small motion', () => {
    const motion = changeScore(blob(20, 18), blob(22, 18));
    const cut = changeScore(blob(20, 18), flat(200));
    expect(motion).toBeLessThan(0.1);
    expect(cut).toBeGreaterThan(0.5);
  });

  it('finds isolated spikes as cuts and merges ones too close together', () => {
    const times = Array.from({ length: 40 }, (_, i) => i * 0.2);
    const scores = times.map(() => 0.03);
    scores[10] = 0.7;
    scores[25] = 0.5;
    scores[26] = 0.8; // same cut seen twice: keep the stronger
    expect(findCuts(scores, times)).toEqual([10, 26]);
  });

  it("doesn't call steady fast motion a cut", () => {
    const times = Array.from({ length: 30 }, (_, i) => i * 0.2);
    const scores = times.map((_, i) => 0.32 + (i % 2) * 0.03);
    expect(findCuts(scores, times)).toEqual([]);
  });

  it('pins a cut to the frame where the picture changes', () => {
    const times = [1, 1.1, 1.2, 1.3, 1.4];
    const lumas = [blob(10, 10), blob(11, 10), blob(12, 10), flat(200), flat(200)];
    // frames up to 1.2 are the old shot; anything after belongs to the new one
    expect(refineCut(times, lumas)).toBeCloseTo(1.201);
  });

  it('follows motion, and falls back to contrast when nothing moves', () => {
    const m = focusPoint(blob(50, 18), blob(48, 18), W, H)!;
    expect(m.x).toBeGreaterThan(0.65);
    expect(m.weight).toBeGreaterThan(0.29);
    const still = focusPoint(blob(12, 18), null, W, H)!;
    expect(still.x).toBeLessThan(0.3);
    expect(still.weight).toBe(0.3);
    expect(focusPoint(flat(80), flat(80), W, H)).toBeNull();
  });

  it('merges duplicate face boxes from several passes', () => {
    const a = { x: 0.1, y: 0.1, w: 0.1, h: 0.1, score: 0.9 };
    const b = { x: 0.11, y: 0.1, w: 0.1, h: 0.1, score: 0.7 };
    const c = { x: 0.6, y: 0.1, w: 0.1, h: 0.1, score: 0.8 };
    expect(mergeBoxes([b, c, a])).toEqual([a, c]);
  });
});

describe('framing geometry', () => {
  it('fits the biggest window of the ratio', () => {
    expect(cropSize(1920, 1080, 9 / 16)).toEqual({ width: 608, height: 1080 });
    expect(cropSize(1920, 1080, 1)).toEqual({ width: 1080, height: 1080 });
    expect(cropSize(1080, 1920, 1)).toEqual({ width: 1080, height: 1080 });
    expect(cropSize(1080, 1920, 4 / 5)).toEqual({ width: 1080, height: 1350 });
  });

  it('exports at standard sizes, or the exact window', () => {
    expect(outputSize(9 / 16, 1080, crop)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(4 / 5, 720, crop)).toEqual({ width: 720, height: 900 });
    expect(outputSize(1, 1080, crop)).toEqual({ width: 1080, height: 1080 });
    expect(outputSize(9 / 16, 0, { width: 607, height: 1080 })).toEqual({ width: 608, height: 1080 });
  });

  it('tiles wide and tall frames into two overlapping squares', () => {
    expect(squareTiles(640, 360)).toEqual([
      { x: 0, y: 0, size: 360 },
      { x: 280, y: 0, size: 360 },
    ]);
    expect(squareTiles(360, 640)[1]).toEqual({ x: 0, y: 280, size: 360 });
    expect(squareTiles(500, 450)).toEqual([]);
  });

  it('keeps the window inside the frame', () => {
    expect(clampCenter({ x: 0.01, y: 0.9 }, 0.3, 1)).toEqual({ x: 0.15, y: 0.5 });
    expect(cropRect({ x: 1, y: 0.5 }, 1920, 1080, crop)).toEqual({ x: 1920 - 608, y: 0, width: 608, height: 1080 });
  });

  it('frames faces that fit together, else sticks with the one it was on', () => {
    const together = subjectTarget([face(0.45), face(0.55)], null, cw, ch)!;
    expect(together.x).toBeCloseTo(0.5);
    // too far apart for one 9:16 window: keep the face nearest the current aim
    expect(subjectTarget([face(0.2), face(0.8)], 0.75, cw, ch)!.x).toBeCloseTo(0.8);
    expect(subjectTarget([face(0.2), face(0.8, 0.12)], null, cw, ch)!.x).toBeCloseTo(0.8);
    expect(subjectTarget([face(0.5, 0.005)], null, cw, ch)).toBeNull();
  });

  it('springs toward a target without overshooting', () => {
    let pos = 0;
    let vel = 0;
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) {
      [pos, vel] = smoothDamp(pos, 1, vel, 0.5, 10, 1 / 30);
      seen.push(pos);
    }
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    expect(pos).toBeGreaterThan(0.99);
    expect(seen.every((v, i) => !i || v >= seen[i - 1])).toBe(true);
  });
});

describe('buildPath', () => {
  it('follows a face and ignores jitter inside the dead zone', () => {
    const jitter = analysis(6, (t) => 0.3 + 0.01 * Math.sin(t * 20));
    const path = buildPath(jitter, cw, ch, SMOOTHING.balanced);
    const xs = [1, 2, 3, 4, 5].map((t) => autoAt(path, t).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.002);
    expect(xs[0]).toBeCloseTo(0.3, 1);
  });

  it('pans smoothly when the subject moves, without lag at the midpoint', () => {
    const path = buildPath(analysis(8, (t) => (t < 4 ? 0.25 : 0.75)), cw, ch, SMOOTHING.balanced);
    expect(autoAt(path, 1).x).toBeCloseTo(0.25, 2);
    expect(autoAt(path, 7.5).x).toBeCloseTo(0.75, 2);
    // forward + backward springs meet in the middle of the move
    expect(autoAt(path, 3.9).x).toBeGreaterThan(0.3);
    expect(autoAt(path, 3.9).x).toBeLessThan(0.7);
    let fastest = 0;
    for (let t = 0; t < 8; t += 1 / 30) fastest = Math.max(fastest, Math.abs(autoAt(path, t + 1 / 30).x - autoAt(path, t).x) * 30);
    expect(fastest).toBeLessThanOrEqual(SMOOTHING.balanced.maxSpeed * cw + 1e-3);
  });

  it('jumps at a scene cut instead of panning across it', () => {
    const path = buildPath(analysis(6, (t) => (t < 3.1 ? 0.2 : 0.8), [3.1]), cw, ch, SMOOTHING.calm);
    expect(path.shots.map((s) => s.start)).toEqual([0, 3.1]);
    expect(autoAt(path, 3.09).x).toBeCloseTo(0.2, 2);
    expect(autoAt(path, 3.1).x).toBeCloseTo(0.8, 2);
  });

  it('holds through short detection gaps and falls back to the centre', () => {
    const path = buildPath(analysis(10, (t) => (t < 2 || (t > 2.6 && t < 4) ? 0.3 : null)), cw, ch, SMOOTHING.balanced);
    expect(autoAt(path, 2.3).x).toBeCloseTo(0.3, 2);
    expect(autoAt(path, 9).x).toBeCloseTo(0.5, 2);
    expect(path.track.find((p) => p.t > 2.2 && p.t < 2.5)?.kind).toBe('face');
    expect(path.track.at(-1)?.kind).toBe('center');
  });
});

describe('keyframes', () => {
  const path = buildPath(analysis(10, () => 0.5, [5]), cw, ch, SMOOTHING.balanced);

  it('a pin takes over from itself onward, easing in', () => {
    const keys = [{ t: 2, x: 0.3, y: 0.5 }];
    expect(centerAt(path, keys, 1).x).toBeCloseTo(0.5);
    expect(centerAt(path, keys, 2 - RAMP / 2).x).toBeCloseTo(0.4);
    expect(centerAt(path, keys, 2).x).toBeCloseTo(0.3);
    expect(centerAt(path, keys, 4.9).x).toBeCloseTo(0.3);
    // never across a cut
    expect(centerAt(path, keys, 6).x).toBeCloseTo(0.5);
  });

  it('pins pan between each other; a track key hands back', () => {
    const keys = [
      { t: 1, x: 0.3, y: 0.5 },
      { t: 3, x: 0.7, y: 0.5 },
      { t: 4, x: 0, y: 0, track: true },
    ];
    expect(centerAt(path, keys, 2).x).toBeCloseTo(0.5);
    expect(centerAt(path, keys, 3).x).toBeCloseTo(0.7);
    expect(manualAt(path, keys, 3.75).weight).toBeCloseTo(0.5);
    expect(centerAt(path, keys, 4.5).x).toBeCloseTo(0.5);
  });

  it('moves a nearby keyframe instead of stacking a new one, and clears a shot', () => {
    let keys = setKey(path, [], { t: 2, x: 0.3, y: 0.5 });
    keys = setKey(path, keys, { t: 2.1, x: 0.4, y: 0.5 });
    expect(keys).toEqual([{ t: 2, x: 0.4, y: 0.5 }]);
    keys = setKey(path, keys, { t: 7, x: 0.6, y: 0.5 });
    expect(shotIndex(path, 7)).toBe(1);
    expect(clearShot(path, keys, 1)).toEqual([{ t: 7, x: 0.6, y: 0.5 }]);
  });
});

describe('auto-reframe-video def', () => {
  it('fits the page rules', () => {
    expect(tool.slug).toBe('auto-reframe-video');
    expect(tool.category).toBe('ai');
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
    expect(tool.steps).toHaveLength(3);
    expect(tool.faq.length).toBeGreaterThanOrEqual(3);
    expect(tool.faq.length).toBeLessThanOrEqual(5);
  });
});

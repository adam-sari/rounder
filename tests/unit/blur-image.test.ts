import { describe, expect, it } from 'vitest';
import { boxBlur, cutByTile, detectionTiles, effectParams, iou, mergeDetections, moveBox, padFace, resizeBox, spanBox } from '../../src/tools/lib/blur-image/regions';

describe('box editing', () => {
  it('spans two points in any order and clamps to the image', () => {
    expect(spanBox(50, 40, 10, 10, 100, 100)).toEqual({ x: 10, y: 10, w: 40, h: 30 });
    expect(spanBox(-20, 90, 30, 130, 100, 100)).toEqual({ x: 0, y: 90, w: 30, h: 10 });
  });

  it('moves a box but keeps it inside', () => {
    expect(moveBox({ x: 10, y: 10, w: 20, h: 20 }, 100, -50, 100, 100)).toEqual({ x: 80, y: 0, w: 20, h: 20 });
  });

  it('resizes from a corner and an edge', () => {
    const b = { x: 10, y: 10, w: 20, h: 20 };
    expect(resizeBox(b, [1, 1], 5, 10, 100, 100)).toEqual({ x: 10, y: 10, w: 25, h: 30 });
    expect(resizeBox(b, [-1, 0], -5, 99, 100, 100)).toEqual({ x: 5, y: 10, w: 25, h: 20 });
  });

  it('flips when dragged past the opposite edge', () => {
    expect(resizeBox({ x: 10, y: 10, w: 20, h: 20 }, [1, 0], -30, 0, 100, 100)).toEqual({ x: 0, y: 10, w: 10, h: 20 });
  });
});

describe('detection tiles', () => {
  it('covers the whole image at every level', () => {
    const W = 6000;
    const H = 4000;
    const tiles = detectionTiles(W, H);
    for (const side of new Set(tiles.map((t) => t.w))) {
      const level = tiles.filter((t) => t.w === side);
      expect(Math.min(...level.map((t) => t.x))).toBe(0);
      expect(Math.max(...level.map((t) => t.x + t.w))).toBe(W);
      expect(Math.max(...level.map((t) => t.y + t.h))).toBe(H);
      for (const t of level) expect(t.x + t.w <= W && t.y + t.h <= H).toBe(true);
    }
    expect(tiles.length).toBeLessThan(120);
  });

  it('skips tiles that would just repeat the whole image, and tiny tiles', () => {
    expect(detectionTiles(300, 300)).toEqual([]);
    expect(detectionTiles(1000, 1000).every((t) => t.w === 500)).toBe(true);
  });

  it('drops detections cut by an inner tile edge but not by the image edge', () => {
    const tile = { x: 500, y: 0, w: 500, h: 500 };
    expect(cutByTile({ x: 500, y: 100, w: 50, h: 50 }, tile, 2000, 2000)).toBe(true);
    expect(cutByTile({ x: 700, y: 0, w: 50, h: 50 }, tile, 2000, 2000)).toBe(false);
    expect(cutByTile({ x: 700, y: 200, w: 50, h: 50 }, tile, 2000, 2000)).toBe(false);
  });
});

describe('merging detections', () => {
  it('folds duplicates from overlapping tiles into one covering box', () => {
    const merged = mergeDetections([
      { x: 100, y: 100, w: 50, h: 50, score: 0.9 },
      { x: 105, y: 102, w: 50, h: 50, score: 0.7 },
      { x: 400, y: 100, w: 40, h: 40, score: 0.8 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ x: 100, y: 100, w: 55, h: 52 });
  });

  it('merges a box that sits inside a bigger one', () => {
    expect(mergeDetections([{ x: 0, y: 0, w: 100, h: 100, score: 0.6 }, { x: 20, y: 20, w: 30, h: 30, score: 0.9 }])).toHaveLength(1);
  });

  it('measures overlap', () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(1);
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(0);
  });

  it('pads a face upwards and stays in the image', () => {
    const p = padFace({ x: 100, y: 100, w: 100, h: 100 }, 1000, 1000);
    expect(p.w).toBeCloseTo(150);
    expect(p.h).toBeCloseTo(180);
    expect(p.y + p.h / 2).toBeLessThan(150);
    expect(padFace({ x: 0, y: 0, w: 100, h: 100 }, 1000, 1000).x).toBe(0);
  });
});

describe('effects', () => {
  it('scales with the region, so preview and full size match', () => {
    const small = effectParams({ w: 100, h: 50 }, 60);
    const big = effectParams({ w: 1000, h: 500 }, 60);
    expect(big.sigma).toBeCloseTo(small.sigma * 10);
    expect([big.cols, big.rows]).toEqual([small.cols, small.rows]);
  });

  it('gets stronger as strength goes up', () => {
    const lo = effectParams({ w: 300, h: 300 }, 20);
    const hi = effectParams({ w: 300, h: 300 }, 100);
    expect(hi.sigma).toBeGreaterThan(lo.sigma);
    expect(hi.cols).toBeLessThan(lo.cols);
  });

  it('box blur leaves a flat image flat and spreads a bright dot', () => {
    const w = 21;
    const h = 21;
    const flat = new Uint8ClampedArray(w * h * 4).fill(120);
    boxBlur(flat, w, h, 3);
    expect(flat.every((v) => v === 120)).toBe(true);

    const dot = new Uint8ClampedArray(w * h * 4);
    const centre = (10 * w + 10) * 4;
    dot.fill(255, centre, centre + 4);
    boxBlur(dot, w, h, 2);
    expect(dot[centre]).toBeLessThan(255);
    expect(dot[centre]).toBeGreaterThan(0);
    expect(dot[(10 * w + 12) * 4]).toBeGreaterThan(0);
    expect(dot[0]).toBe(0);
  });
});

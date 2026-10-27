import { describe, expect, it } from 'vitest';
import { canvasSize, cellBoxes, coverCrop, DEFAULT_VIEW, layouts, layoutsFor, panView } from '../../src/tools/lib/collage-maker/layout';

describe('layouts', () => {
  it('have unique ids and cover every count from 2 to 9', () => {
    expect(new Set(layouts.map((l) => l.id)).size).toBe(layouts.length);
    for (let n = 2; n <= 9; n++) expect(layoutsFor(n).length).toBeGreaterThanOrEqual(2);
  });

  it.each(layouts.map((l) => [l.id, l] as const))('%s tiles its grid exactly once', (_, l) => {
    const grid = Array.from({ length: l.rows }, () => Array<number>(l.cols).fill(0));
    for (const [x, y, w, h] of l.cells) {
      for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) grid[r][c]++;
    }
    expect(grid.flat().every((n) => n === 1)).toBe(true);
  });
});

describe('cellBoxes', () => {
  it('keeps gutters and the outer border even', () => {
    const l = layouts.find((x) => x.id === '5-2-3')!;
    const b = cellBoxes(l, 1000, 800, 20, 30);
    expect(b[0]).toMatchObject({ x: 30, y: 30 });
    expect(b[1].x - (b[0].x + b[0].w)).toBe(20);
    expect(b[2].y - (b[0].y + b[0].h)).toBe(20);
    expect(b[4].x + b[4].w).toBe(970);
    expect(b[4].y + b[4].h).toBe(770);
  });

  it('fills the canvas with no gaps or padding', () => {
    const b = cellBoxes(layouts.find((x) => x.id === '2-cols')!, 1000, 500, 0, 0);
    expect(b).toEqual([{ x: 0, y: 0, w: 500, h: 500 }, { x: 500, y: 0, w: 500, h: 500 }]);
  });
});

describe('canvasSize', () => {
  it('puts the long side on the right axis', () => {
    expect(canvasSize(4, 5, 2160)).toEqual({ w: 1728, h: 2160 });
    expect(canvasSize(16, 9, 1920)).toEqual({ w: 1920, h: 1080 });
  });
});

describe('coverCrop', () => {
  it('centre-crops a wide photo into a square cell', () => {
    expect(coverCrop(4000, 2000, 500, 500, DEFAULT_VIEW)).toEqual({ sx: 1000, sy: 0, sw: 2000, sh: 2000 });
  });

  it('zooms and follows the focus point', () => {
    const c = coverCrop(4000, 2000, 500, 500, { zoom: 2, fx: 0, fy: 1 });
    expect(c).toEqual({ sx: 0, sy: 1000, sw: 1000, sh: 1000 });
  });
});

describe('panView', () => {
  it('drags the photo with the pointer and stops at the edges', () => {
    // 2000 px of slack, 500 cell px show 2000 source px → 1 cell px = 4 source px
    const moved = panView(DEFAULT_VIEW, 4000, 2000, 500, 500, 50, 0);
    expect(moved.fx).toBeCloseTo(0.5 - 200 / 2000);
    expect(moved.fy).toBe(0.5);
    expect(panView(DEFAULT_VIEW, 4000, 2000, 500, 500, -10_000, 0).fx).toBe(1);
  });
});

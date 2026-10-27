import { describe, expect, it } from 'vitest';
import { cropPixels, extractTile, gridSize, hexToRgb, panBy, placeImage, postingOrder, tileName, visibleRegion } from '../../src/tools/lib/instagram-grid/grid';

describe('gridSize', () => {
  it('uses three columns for a profile grid', () => {
    expect(gridSize('grid', 3, '3:4', 1080)).toEqual({ cols: 3, rows: 3, tw: 1080, th: 1440, width: 3240, height: 4320 });
  });
  it('lays carousel slides side by side', () => {
    expect(gridSize('carousel', 5, '4:5', 1080)).toMatchObject({ cols: 5, rows: 1, th: 1350, width: 5400, height: 1350 });
  });
});

describe('placeImage', () => {
  it('covers the grid in fill mode and centres by default', () => {
    const p = placeImage(4000, 3000, 3240, 4320, 'fill', 1, 0.5, 0.5);
    expect(p.ih).toBeCloseTo(4320);
    expect(p.iw).toBeCloseTo(5760);
    expect(p.ox).toBeCloseTo(-1260);
    expect(p.oy).toBeCloseTo(0);
  });
  it('fits inside the grid in fit mode', () => {
    const p = placeImage(4000, 3000, 3240, 4320, 'fit', 1, 0.5, 0.5);
    expect(p.iw).toBeCloseTo(3240);
    expect(p.oy).toBeCloseTo((4320 - 2430) / 2);
  });
});

describe('panBy', () => {
  it('moves the image with the pointer and clamps at the edges', () => {
    const p = placeImage(4000, 3000, 3240, 4320, 'fill', 1, 0.5, 0.5);
    const right = panBy(p, 3240, 4320, 0.5, 0.5, 630, 0);
    expect(right.px).toBeCloseTo(0.25); // ox goes from -1260 to -630
    expect(panBy(p, 3240, 4320, 0.5, 0.5, 5000, 0).px).toBe(0);
    expect(right.py).toBe(0.5); // no vertical room, so no change
  });
});

describe('visibleRegion', () => {
  it('maps the centre crop back to source pixels', () => {
    const p = placeImage(4000, 3000, 3240, 4320, 'fill', 1, 0.5, 0.5);
    const { src, dst } = visibleRegion(4000, 3000, 3240, 4320, p);
    expect(dst).toEqual({ x: 0, y: 0, width: 3240, height: 4320 });
    expect(src).toEqual({ x: 875, y: 0, width: 2250, height: 3000 });
  });
  it('leaves room around a fitted image', () => {
    const p = placeImage(4000, 3000, 3240, 4320, 'fit', 1, 0.5, 0.5);
    const { src, dst } = visibleRegion(4000, 3000, 3240, 4320, p);
    expect(src).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
    expect(dst).toMatchObject({ x: 0, y: 945, width: 3240, height: 2430 });
  });
});

describe('posting order and names', () => {
  it('posts the bottom-right tile first on a profile grid', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => postingOrder(i, 9, 'grid'))).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect([0, 1, 2].map((i) => postingOrder(i, 3, 'carousel'))).toEqual([1, 2, 3]);
  });
  it('names files so they sort in upload order', () => {
    expect(tileName(1, 9, 'grid', 'jpg')).toBe('01-post-first.jpg');
    expect(tileName(5, 9, 'grid', 'jpg')).toBe('05.jpg');
    expect(tileName(9, 9, 'grid', 'png')).toBe('09-post-last.png');
    expect(tileName(10, 10, 'carousel', 'jpg')).toBe('10-slide-last.jpg');
  });
});

describe('pixels', () => {
  // 2×2 image: red, green / blue, half-transparent white
  const img = { width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128]) };

  it('crops a rectangle', () => {
    expect(Array.from(cropPixels(img, { x: 1, y: 0, width: 1, height: 2 }))).toEqual([0, 255, 0, 255, 255, 255, 255, 128]);
  });

  it('fills outside the image with the background and blends alpha', () => {
    const tile = extractTile(img, { x: 1, y: 1 }, { x: 0, y: 0, width: 3, height: 3 }, hexToRgb('#000000'));
    const px = (x: number, y: number) => Array.from(tile.slice((y * 3 + x) * 4, (y * 3 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(2, 2)).toEqual([128, 128, 128, 255]);
  });
});

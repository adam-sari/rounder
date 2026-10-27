import { describe, expect, it } from 'vitest';
import { containRect, defaultSelection, focalCrop, outputName, panFocus, pixelCrop, sizes, upscaled } from '@/tools/lib/social-media-image-resizer/sizes';
import def from '@/tools/defs/social-media-image-resizer';

const center = { x: 0.5, y: 0.5 };
const size = (id: string) => sizes.find((s) => s.id === id)!;

describe('focalCrop', () => {
  it('crops the middle of a landscape photo to a square', () => {
    expect(focalCrop(4000, 3000, 1080, 1080, center)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
  });

  it('follows the focus point until it meets the edge', () => {
    expect(focalCrop(4000, 3000, 1080, 1080, { x: 0.6, y: 0.5 }).x).toBe(900);
    expect(focalCrop(4000, 3000, 1080, 1080, { x: 0.95, y: 0.5 }).x).toBe(1000);
    expect(focalCrop(4000, 3000, 1080, 1080, { x: 0, y: 0.5 }).x).toBe(0);
  });

  it('zooms in around the focus', () => {
    expect(focalCrop(1000, 1000, 100, 100, center, 2)).toEqual({ x: 250, y: 250, width: 500, height: 500 });
  });

  it('keeps the frame shape', () => {
    const r = focalCrop(3000, 2000, 1500, 500, { x: 0.3, y: 0.8 });
    expect(r.width / r.height).toBeCloseTo(3);
    expect(r.y + r.height).toBeLessThanOrEqual(2000);
  });
});

describe('panFocus', () => {
  it('dragging the picture right moves the crop left', () => {
    // a 2000 × 1000 image in a square: the crop is 1000 wide, shown at 1080 px
    const f = panFocus(2000, 1000, 1080, 1080, center, 108, 0);
    expect(f.x).toBeCloseTo(0.45);
    expect(f.y).toBe(0.5);
  });

  it('stops at the edges instead of running away', () => {
    const f = panFocus(2000, 1000, 1080, 1080, center, 100_000, 0);
    expect(f.x).toBeCloseTo(0.25);
    expect(panFocus(2000, 1000, 1080, 1080, f, -54, 0).x).toBeCloseTo(0.275);
  });
});

describe('containRect', () => {
  it('fits a landscape image inside a story', () => {
    expect(containRect(2000, 1000, 1080, 1920)).toEqual({ x: 0, y: 690, width: 1080, height: 540 });
  });
});

describe('pixelCrop', () => {
  it('rounds without spilling past the image', () => {
    expect(pixelCrop({ x: 10.6, y: -0.2, width: 99.9, height: 50.4 }, 100, 50)).toEqual({ x: 11, y: 0, width: 89, height: 50 });
  });
});

describe('sizes', () => {
  it('has unique ids and a valid default selection', () => {
    const ids = sizes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of defaultSelection) expect(ids).toContain(id);
  });

  it('includes the well-known sizes', () => {
    expect(size('x-header')).toMatchObject({ width: 1500, height: 500 });
    expect(size('yt-banner')).toMatchObject({ width: 2560, height: 1440, safe: { width: 1546, height: 423 } });
    expect(size('yt-thumb')).toMatchObject({ width: 1280, height: 720 });
    expect(size('pin')).toMatchObject({ width: 1000, height: 1500 });
  });

  it('flags upscaling', () => {
    expect(upscaled(800, 600, size('ig-post'), 'crop')).toBe(true);
    expect(upscaled(4000, 3000, size('ig-post'), 'crop')).toBe(false);
    // fitted whole, a 2000 × 1000 image only needs to be 1080 wide in a story
    expect(upscaled(2000, 1000, size('ig-story'), 'blur')).toBe(false);
  });
});

describe('outputName', () => {
  it('names files by platform, size and dimensions', () => {
    expect(outputName('beach.HEIC', size('ig-story'), 'jpg')).toBe('beach-instagram-story-reel-1080x1920.jpg');
    expect(outputName('logo.png', size('x-header'), 'png')).toBe('logo-x-header-1500x500.png');
    expect(outputName('.png', size('pin'), 'jpg')).toBe('image-pinterest-pin-1000x1500.jpg');
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
  });
});

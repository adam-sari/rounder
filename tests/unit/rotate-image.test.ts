import { describe, expect, it } from 'vitest';
import { boundingSize, flipOnScreen, innerCropSize, outputSuffix, quarter, turnedSize } from '@/tools/lib/rotate-image/geometry';

describe('quarter', () => {
  it('normalises any multiple of 90', () => {
    expect(quarter(0)).toBe(0);
    expect(quarter(-90)).toBe(270);
    expect(quarter(450)).toBe(90);
    expect(quarter(-720)).toBe(0);
  });
});

describe('flipOnScreen', () => {
  const upright = { rotate: 0 as const, flipX: false, flipY: false };
  it('flips the matching source axis when upright', () => {
    expect(flipOnScreen(upright, 'horizontal')).toMatchObject({ flipX: true, flipY: false });
    expect(flipOnScreen(upright, 'vertical')).toMatchObject({ flipX: false, flipY: true });
  });
  it('swaps axes once the picture is on its side', () => {
    expect(flipOnScreen({ ...upright, rotate: 90 }, 'horizontal')).toMatchObject({ flipX: false, flipY: true });
    expect(flipOnScreen({ ...upright, rotate: 270 }, 'vertical')).toMatchObject({ flipX: true, flipY: false });
  });
});

describe('sizes', () => {
  it('swaps sides for quarter turns', () => {
    expect(turnedSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(turnedSize(400, 300, 180)).toEqual({ width: 400, height: 300 });
  });

  it('leaves a level image alone', () => {
    expect(boundingSize(400, 300, 0)).toEqual({ width: 400, height: 300 });
    expect(innerCropSize(400, 300, 0)).toEqual({ width: 400, height: 300 });
  });

  it('grows the canvas to hold the tilted image', () => {
    // a square at 45° needs a canvas √2 times wider
    expect(boundingSize(100, 100, 45)).toEqual({ width: 142, height: 142 });
    expect(boundingSize(100, 100, -45)).toEqual(boundingSize(100, 100, 45));
  });

  it('crops to a same-shape rectangle that fits inside the tilted image', () => {
    const w = 4000;
    const h = 3000;
    for (const deg of [1, 5, -12, 30, 45]) {
      const crop = innerCropSize(w, h, deg);
      expect(crop.width / crop.height).toBeCloseTo(w / h, 2);
      // every corner of the crop, rotated back into the image's frame, lands inside it
      const t = (deg * Math.PI) / 180;
      for (const [x, y] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const px = (x * crop.width) / 2;
        const py = (y * crop.height) / 2;
        expect(Math.abs(px * Math.cos(t) + py * Math.sin(t))).toBeLessThanOrEqual(w / 2);
        expect(Math.abs(-px * Math.sin(t) + py * Math.cos(t))).toBeLessThanOrEqual(h / 2);
      }
    }
    // a small tilt only loses a little
    expect(innerCropSize(w, h, 1).width).toBeGreaterThan(w * 0.95);
  });
});

describe('outputSuffix', () => {
  it('names the file after what was done', () => {
    expect(outputSuffix({ rotate: 90, flipX: false, flipY: false }, 0)).toBe('-rotated');
    expect(outputSuffix({ rotate: 0, flipX: false, flipY: false }, 2.5)).toBe('-straightened');
    expect(outputSuffix({ rotate: 0, flipX: true, flipY: false }, 0)).toBe('-flipped');
    expect(outputSuffix({ rotate: 0, flipX: false, flipY: false }, 0)).toBe('-upright');
  });
});

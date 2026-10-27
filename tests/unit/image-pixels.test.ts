import { describe, expect, it } from 'vitest';
import { cropPixels, orientPixels } from '@/engines/image/pixels';

// Node has no ImageData; this is all the helpers use of it
class FakeImageData {
  data: Uint8ClampedArray;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

(globalThis as { ImageData?: unknown }).ImageData ??= FakeImageData;

/** a w×h image whose pixel at (x, y) has red = x and green = y */
function grid(w: number, h: number) {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set([x, y, 0, 255], (y * w + x) * 4);
  return img;
}

const at = (img: ImageData, x: number, y: number) => [img.data[(y * img.width + x) * 4], img.data[(y * img.width + x) * 4 + 1]];

describe('cropPixels', () => {
  it('copies the rectangle', () => {
    const out = cropPixels(grid(5, 4), { x: 1, y: 2, width: 3, height: 2 });
    expect([out.width, out.height]).toEqual([3, 2]);
    expect(at(out, 0, 0)).toEqual([1, 2]);
    expect(at(out, 2, 1)).toEqual([3, 3]);
  });

  it('clamps to the image and returns it untouched when nothing is cut', () => {
    const img = grid(4, 4);
    expect(cropPixels(img, { x: 0, y: 0, width: 4, height: 4 })).toBe(img);
    const out = cropPixels(img, { x: 2, y: 2, width: 10, height: 10 });
    expect([out.width, out.height]).toEqual([2, 2]);
  });
});

describe('orientPixels', () => {
  const img = grid(3, 2);

  it('turns clockwise', () => {
    const r90 = orientPixels(img, 90);
    expect([r90.width, r90.height]).toEqual([2, 3]);
    // the top-left corner ends up top-right
    expect(at(r90, 1, 0)).toEqual([0, 0]);
    expect(at(r90, 0, 2)).toEqual([2, 1]);
    const r180 = orientPixels(img, 180);
    expect(at(r180, 2, 1)).toEqual([0, 0]);
    const r270 = orientPixels(img, 270);
    expect([r270.width, r270.height]).toEqual([2, 3]);
    expect(at(r270, 0, 2)).toEqual([0, 0]);
  });

  it('flips before turning', () => {
    expect(at(orientPixels(img, 0, true), 0, 0)).toEqual([2, 0]);
    expect(at(orientPixels(img, 0, false, true), 0, 0)).toEqual([0, 1]);
    // mirrored then turned: the top-right source corner lands top-right
    expect(at(orientPixels(img, 90, true), 1, 0)).toEqual([2, 0]);
  });

  it('leaves an unchanged image alone', () => {
    expect(orientPixels(img)).toBe(img);
  });
});

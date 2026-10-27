import { describe, expect, it } from 'vitest';
import { dragRect, flipHorizontal, flipVertical, maxBox, placeBox, resizeTo, toDisplay, toSource, type Orientation } from '@/tools/lib/crop-image/geometry';

const W = 400;
const H = 300;
const none: Orientation = { rotate: 0, flipX: false, flipY: false };

describe('orientation mapping', () => {
  const r = { x: 10, y: 20, width: 50, height: 30 };

  it('is the identity with no rotation or flip', () => {
    expect(toSource(r, W, H, none)).toEqual(r);
  });

  it('maps a rect on a 90° rotated image back to source pixels', () => {
    // rotated 90° clockwise the image is 300 × 400 and its top-left came from the source's bottom-left
    const o: Orientation = { rotate: 90, flipX: false, flipY: false };
    expect(toSource({ x: 0, y: 0, width: 30, height: 50 }, W, H, o)).toEqual({ x: 0, y: 270, width: 50, height: 30 });
  });

  it('handles flips', () => {
    expect(toSource(r, W, H, { rotate: 0, flipX: true, flipY: false })).toEqual({ x: 340, y: 20, width: 50, height: 30 });
    expect(toSource(r, W, H, { rotate: 0, flipX: false, flipY: true })).toEqual({ x: 10, y: 250, width: 50, height: 30 });
  });

  it('round-trips through every orientation', () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          const o = { rotate, flipX, flipY };
          expect(toSource(toDisplay(r, W, H, o), W, H, o)).toEqual(r);
        }
      }
    }
  });

  it('flips as seen on screen after a rotation', () => {
    const rotated: Orientation = { rotate: 90, flipX: false, flipY: false };
    const flipped = flipHorizontal(rotated);
    // the left edge on screen becomes the right edge on screen
    const left = { x: 0, y: 0, width: 10, height: 400 };
    const right = { x: 290, y: 0, width: 10, height: 400 };
    expect(toSource(right, W, H, flipped)).toEqual(toSource(left, W, H, rotated));
    expect(flipVertical(flipVertical(rotated))).toEqual(rotated);
  });
});

describe('dragRect', () => {
  const start = { x: 100, y: 100, width: 100, height: 100 };

  it('moves and stays inside the image', () => {
    expect(dragRect(start, 'move', 20, -10, W, H, null)).toEqual({ x: 120, y: 90, width: 100, height: 100 });
    expect(dragRect(start, 'move', 1000, 1000, W, H, null)).toEqual({ x: 300, y: 200, width: 100, height: 100 });
  });

  it('resizes from an edge or corner', () => {
    expect(dragRect(start, 'e', 30, 0, W, H, null)).toEqual({ x: 100, y: 100, width: 130, height: 100 });
    expect(dragRect(start, 'nw', -20, -40, W, H, null)).toEqual({ x: 80, y: 60, width: 120, height: 140 });
  });

  it('clamps to the image edges', () => {
    expect(dragRect(start, 'se', 1000, 1000, W, H, null)).toEqual({ x: 100, y: 100, width: 300, height: 200 });
  });

  it('flips when dragged past the opposite side', () => {
    expect(dragRect(start, 'e', -150, 0, W, H, null)).toEqual({ x: 50, y: 100, width: 50, height: 100 });
  });

  it('keeps a locked aspect ratio', () => {
    const r = dragRect(start, 'se', 60, 20, W, H, 1);
    expect(r.width).toBe(r.height);
    const wide = dragRect(start, 'e', 60, 0, W, H, 16 / 9);
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
    // edge handles keep the box centred on the other axis
    expect(wide.y + wide.height / 2).toBeCloseTo(150, 0);
  });

  it('never grows a locked box past the image', () => {
    const r = dragRect(start, 'se', 5000, 5000, W, H, 1);
    expect(r).toEqual({ x: 100, y: 100, width: 200, height: 200 });
  });

  it('respects a minimum size', () => {
    expect(dragRect(start, 'e', -99, 0, W, H, null, 20).width).toBe(20);
  });
});

describe('placing and typing sizes', () => {
  it('finds the largest box of a ratio', () => {
    expect(maxBox(1, W, H)).toEqual({ width: 300, height: 300 });
    expect(maxBox(16 / 9, W, H)).toEqual({ width: 400, height: 225 });
  });

  it('centres and slides a box back inside', () => {
    expect(placeBox(390, 10, 100, 100, W, H, 1)).toEqual({ x: 300, y: 0, width: 100, height: 100 });
    expect(placeBox(200, 150, 600, 300, W, H, 2)).toEqual({ x: 0, y: 50, width: 400, height: 200 });
  });

  it('applies typed sizes with and without a ratio', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 };
    expect(resizeTo(r, 'width', 250, W, H, null)).toEqual({ x: 0, y: 0, width: 250, height: 100 });
    expect(resizeTo(r, 'width', 200, W, H, 4 / 5)).toEqual({ x: 0, y: 0, width: 200, height: 250 });
    expect(resizeTo({ ...r, x: 350 }, 'width', 9999, W, H, null)).toEqual({ x: 0, y: 0, width: 400, height: 100 });
  });
});

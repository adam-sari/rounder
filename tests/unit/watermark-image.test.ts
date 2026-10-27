import { describe, expect, it } from 'vitest';
import { isDark, placeMark, rotatedBox, sizeSvg, tileCenters } from '@/tools/lib/watermark-image/layout';

describe('rotatedBox', () => {
  it('swaps sides at 90 degrees', () => {
    const b = rotatedBox(200, 50, Math.PI / 2);
    expect(b.width).toBeCloseTo(50);
    expect(b.height).toBeCloseTo(200);
  });
});

describe('placeMark', () => {
  it('anchors corners inside the margin', () => {
    expect(placeMark(1000, 800, 200, 50, 0, 'br', 20)).toEqual({ width: 200, height: 50, x: 880, y: 755 });
    expect(placeMark(1000, 800, 200, 50, 0, 'tl', 20)).toEqual({ width: 200, height: 50, x: 120, y: 45 });
    expect(placeMark(1000, 800, 200, 50, 0, 'mc', 20)).toMatchObject({ x: 500, y: 400 });
  });

  it('shrinks a mark that would not fit', () => {
    const p = placeMark(1000, 100, 900, 300, 0, 'mc', 10);
    expect(p.height).toBeCloseTo(80);
    expect(p.width).toBeCloseTo(240);
  });

  it('keeps a rotated mark inside the image', () => {
    const p = placeMark(1000, 1000, 400, 100, Math.PI / 4, 'tr', 0);
    const box = rotatedBox(p.width, p.height, Math.PI / 4);
    expect(p.x + box.width / 2).toBeCloseTo(1000);
    expect(p.y - box.height / 2).toBeCloseTo(0);
  });
});

describe('tileCenters', () => {
  it('covers the whole image, including the corners', () => {
    const W = 1200;
    const H = 800;
    const pts = tileCenters(W, H, 200, 40, -Math.PI / 6, 30);
    expect(pts.length).toBeGreaterThan(20);
    for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2]]) {
      const nearest = Math.min(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
      expect(nearest).toBeLessThan(200);
    }
  });

  it('scales with the image so mixed sizes get the same pattern', () => {
    const small = tileCenters(1000, 600, 200, 40, 0.5, 20);
    const big = tileCenters(5000, 3000, 1000, 200, 0.5, 100);
    expect(big.length).toBe(small.length);
  });
});

describe('isDark', () => {
  it('tells dark from light', () => {
    expect(isDark('#000000')).toBe(true);
    expect(isDark('#1a3c8f')).toBe(true);
    expect(isDark('#ffffff')).toBe(false);
    expect(isDark('#ffd25e')).toBe(false);
  });
});

describe('sizeSvg', () => {
  it('keeps an svg that already has a size', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect/></svg>';
    expect(sizeSvg(svg)).toEqual({ svg, aspect: 3 });
  });

  it('adds a size from the viewBox', () => {
    const out = sizeSvg('<svg viewBox="0 0 50 100" width="100%" stroke-width="2"><path/></svg>');
    expect(out?.aspect).toBe(0.5);
    expect(out?.svg).toBe('<svg width="512" height="1024" viewBox="0 0 50 100" stroke-width="2"><path/></svg>');
  });

  it('gives up on svgs with no size at all', () => {
    expect(sizeSvg('<svg><path/></svg>')).toBeNull();
    expect(sizeSvg('not an svg')).toBeNull();
  });
});

describe('tileCenters limits', () => {
  it('caps the mark count for long thin text with no spacing', () => {
    // a long line of text at the smallest size on a tall photo, spacing 0
    const pts = tileCenters(4000, 12000, 200, 1.5, -Math.PI / 6, 0);
    expect(pts.length).toBeLessThan(1300);
    expect(pts.length).toBeGreaterThan(200);
  });
});

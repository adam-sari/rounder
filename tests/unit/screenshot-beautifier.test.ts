import { describe, expect, it } from 'vitest';
import {
  backgroundGradient, captionColor, computeLayout, exportScale, gradientLine, MAX_PIXELS, outputName, type Settings,
} from '@/tools/lib/screenshot-beautifier/layout';
import def from '@/tools/defs/screenshot-beautifier';

const base: Settings = {
  background: { kind: 'preset', id: 'sunrise' },
  padding: 50,
  radius: 12,
  shadow: 'soft',
  border: true,
  frame: 'none',
  theme: 'light',
  url: '',
  aspect: 'auto',
  caption: '',
};

describe('computeLayout', () => {
  it('wraps the screenshot in padding scaled to its size', () => {
    const L = computeLayout(1200, 800, base);
    expect(L.k).toBe(1);
    expect(L).toMatchObject({ width: 1300, height: 900, shot: { x: 50, y: 50, w: 1200, h: 800 } });
  });

  it('draws big screenshots at the base size', () => {
    const L = computeLayout(2880, 1800, base);
    expect(L.shot.w).toBe(1440);
    expect(L.shot.h).toBe(900);
  });

  it('puts a title bar above the screenshot', () => {
    const L = computeLayout(1200, 800, { ...base, frame: 'mac' });
    expect(L.bar).toBeGreaterThan(0);
    expect(L.frame.h).toBe(800 + L.bar);
    expect(L.shot.y).toBe(L.frame.y + L.bar);
  });

  it('grows the short side to hit a fixed aspect ratio and centres the window', () => {
    const wide = computeLayout(1200, 800, { ...base, aspect: '9:16' });
    expect(wide.width).toBe(1300);
    expect(wide.height).toBe(Math.round((1300 * 16) / 9));
    expect(wide.frame.x).toBe(50);
    expect(wide.frame.y).toBeCloseTo((wide.height - 800) / 2, 0);

    const tall = computeLayout(600, 1200, { ...base, aspect: '16:9' });
    expect(tall.width / tall.height).toBeCloseTo(16 / 9, 2);
  });

  it('makes room for a caption below the window', () => {
    const plain = computeLayout(1200, 800, base);
    const captioned = computeLayout(1200, 800, { ...base, caption: 'Hello' });
    expect(captioned.height).toBeGreaterThan(plain.height);
    expect(captioned.caption!.y).toBeGreaterThan(captioned.frame.y + captioned.frame.h);
    expect(computeLayout(1200, 800, { ...base, caption: '   ' }).caption).toBeUndefined();
  });

  it('never rounds corners past half the window', () => {
    expect(computeLayout(40, 40, { ...base, radius: 48 }).radius).toBeLessThanOrEqual(20);
  });
});

describe('gradientLine', () => {
  it('matches CSS angles', () => {
    expect(gradientLine(100, 50, 90)).toMatchObject({ x0: 0, x1: 100 });
    const down = gradientLine(100, 50, 180);
    expect(down.y0).toBeCloseTo(0);
    expect(down.y1).toBeCloseTo(50);
  });
});

describe('colors', () => {
  it('turns every background kind into a gradient or nothing', () => {
    expect(backgroundGradient({ kind: 'solid', color: '#ffffff' })?.stops).toEqual(['#ffffff']);
    expect(backgroundGradient({ kind: 'custom', from: '#000000', to: '#ffffff', angle: 45 })).toEqual({ angle: 45, stops: ['#000000', '#ffffff'] });
    expect(backgroundGradient({ kind: 'preset', id: 'missing' })).not.toBeNull();
    expect(backgroundGradient({ kind: 'none' })).toBeNull();
  });

  it('picks a readable caption color', () => {
    expect(captionColor({ angle: 0, stops: ['#ffffff'] })).toBe('#1c1b19');
    expect(captionColor({ angle: 0, stops: ['#111111', '#222222'] })).toBe('#ffffff');
  });
});

describe('export', () => {
  it('keeps the requested scale unless the canvas would be too big', () => {
    expect(exportScale(1500, 1000, 2)).toBe(2);
    const s = exportScale(3000, 5000, 2);
    expect(s).toBeLessThan(2);
    expect(3000 * s * 5000 * s).toBeLessThanOrEqual(MAX_PIXELS + 1);
  });

  it('names files sensibly', () => {
    expect(outputName('image.png', 'png')).toBe('screenshot-beautified.png');
    expect(outputName('Screen Shot 2024-05-01.png', 'jpg')).toBe('Screen Shot 2024-05-01-beautified.jpg');
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
  });
});

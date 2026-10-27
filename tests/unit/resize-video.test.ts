import { describe, expect, it } from 'vitest';
import { coverCrop, customSide, fitRect, overflowAxis, platforms, resizePlan, sameAspect, upscaleFactor } from '@/tools/lib/resize-video/layout';

const mid = { x: 0.5, y: 0.5 };

describe('platform presets', () => {
  it('uses even sizes everywhere', () => {
    for (const p of platforms) expect([p.width % 2, p.height % 2]).toEqual([0, 0]);
  });
});

describe('coverCrop', () => {
  it('cuts a centred 9:16 slice from a 16:9 video', () => {
    expect(coverCrop(1920, 1080, 1080, 1920, mid)).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
  });

  it('slides with the focus like object-position', () => {
    expect(coverCrop(1920, 1080, 1080, 1920, { x: 0, y: 0.5 }).x).toBe(0);
    expect(coverCrop(1920, 1080, 1080, 1920, { x: 1, y: 0.5 }).x).toBe(1312);
  });

  it('crops top and bottom when the source is taller than the frame', () => {
    expect(coverCrop(1080, 1920, 1080, 1080, { x: 0.5, y: 0.25 })).toEqual({ x: 0, y: 210, width: 1080, height: 1080 });
  });
});

describe('fitRect', () => {
  it('letterboxes with contain and overflows with cover', () => {
    expect(fitRect(1920, 1080, 1080, 1920, 'contain')).toEqual({ x: 0, y: 656.25, width: 1080, height: 607.5 });
    const c = fitRect(1920, 1080, 1080, 1920, 'cover');
    expect(c.height).toBe(1920);
    expect(c.x).toBeCloseTo(-1166.67, 1);
  });
});

describe('resizePlan', () => {
  it('plain-resizes when the shape already matches', () => {
    expect(resizePlan(3840, 2160, 1920, 1080, 'blur', mid)).toEqual({ width: 1920, height: 1080, fit: 'fill' });
    expect(sameAspect(1918, 1080, 1920, 1080)).toBe(true);
    expect(overflowAxis(1920, 1080, 1280, 720)).toBeNull();
  });

  it('crops to cover in fill mode', () => {
    expect(resizePlan(1920, 1080, 1080, 1080, 'fill', mid)).toEqual({ width: 1080, height: 1080, fit: 'cover', crop: { x: 420, y: 0, width: 1080, height: 1080 } });
  });

  it('hands fit modes to the render hook', () => {
    expect(resizePlan(1920, 1080, 1080, 1920, 'blur', mid)).toEqual({ width: 1080, height: 1920, backdrop: 'blur' });
    expect(resizePlan(1920, 1080, 1080, 1350, 'color', mid).backdrop).toBe('color');
  });
});

describe('sizes', () => {
  it('clamps and evens custom sides', () => {
    expect(customSide(1081)).toBe(1082);
    expect(customSide(3)).toBe(16);
    expect(customSide(99999)).toBe(4096);
    expect(customSide(Number.NaN)).toBe(16);
  });

  it('measures upscaling per mode', () => {
    expect(upscaleFactor(1280, 720, 1080, 1920, 'blur')).toBeCloseTo(0.84, 2);
    expect(upscaleFactor(1280, 720, 1080, 1920, 'fill')).toBeCloseTo(2.67, 2);
    expect(overflowAxis(1920, 1080, 1080, 1920)).toBe('x');
    expect(overflowAxis(1080, 1920, 1080, 1080)).toBe('y');
  });
});

import { describe, expect, it } from 'vitest';
import { resolveSize } from '@/engines/image/types';

describe('resolveSize', () => {
  it('scales by percent', () => {
    expect(resolveSize(4000, 3000, { mode: 'scale', percent: 25 })).toEqual({ width: 1000, height: 750 });
  });

  it('fits inside a box keeping the aspect ratio', () => {
    expect(resolveSize(4000, 3000, { mode: 'fit', width: 1920, height: 1920 })).toEqual({ width: 1920, height: 1440 });
    expect(resolveSize(3000, 4000, { mode: 'fit', width: 1920, height: 1920 })).toEqual({ width: 1440, height: 1920 });
  });

  it('fits by width alone', () => {
    expect(resolveSize(4000, 3000, { mode: 'fit', width: 800 })).toEqual({ width: 800, height: 600 });
  });

  it('never enlarges unless asked', () => {
    expect(resolveSize(800, 600, { mode: 'fit', width: 1920, height: 1920 })).toEqual({ width: 800, height: 600 });
    expect(resolveSize(800, 600, { mode: 'fit', width: 1600, enlarge: true })).toEqual({ width: 1600, height: 1200 });
  });

  it('fills a box and crops the overflow from the centre', () => {
    const r = resolveSize(4000, 3000, { mode: 'fill', width: 1080, height: 1080 });
    expect(r).toEqual({ width: 1440, height: 1080, crop: { x: 180, y: 0, width: 1080, height: 1080 } });
  });

  it('stretches to an exact size', () => {
    expect(resolveSize(4000, 3000, { mode: 'stretch', width: 100, height: 100 })).toEqual({ width: 100, height: 100 });
  });

  it('never returns a zero dimension', () => {
    expect(resolveSize(5000, 2, { mode: 'scale', percent: 1 })).toEqual({ width: 50, height: 1 });
  });
});

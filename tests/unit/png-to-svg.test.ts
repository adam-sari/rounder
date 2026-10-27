import { describe, expect, it } from 'vitest';
import { edgeColor, removeBackground, traceImage, type Pixels } from '@/tools/lib/trace/trace';
import { matchPreset, presets } from '@/tools/lib/trace/settings';

/** a white square image with a filled red square in the middle */
function picture(size = 40, inset = 10): Pixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const red = x >= inset && x < size - inset && y >= inset && y < size - inset;
      data.set(red ? [220, 30, 40, 255] : [255, 255, 255, 255], i);
    }
  }
  return { width: size, height: size, data };
}

describe('background removal', () => {
  it('finds the edge color', () => {
    expect(edgeColor(picture())).toEqual([255, 255, 255]);
  });
  it('clears only the connected background', () => {
    const img = picture();
    // a white hole inside the red square must survive
    img.data.set([255, 255, 255, 255], (20 * 40 + 20) * 4);
    const removed = removeBackground(img, [255, 255, 255]);
    expect(removed).toBe(40 * 40 - 20 * 20);
    expect(img.data[(20 * 40 + 20) * 4 + 3]).toBe(255);
    expect(img.data[3]).toBe(0);
  });
});

describe('traceImage', () => {
  const settings = { ...presets.logo, removeBg: false };

  it('traces both colors with the original size and traced viewBox', () => {
    const r = traceImage(picture(), settings, { width: 400, height: 400 });
    expect(r.svg).toContain('width="400" height="400" viewBox="0 0 40 40"');
    expect(r.colors).toBe(2);
    expect(r.paths).toBeGreaterThanOrEqual(2);
  });

  it('drops the background when asked', () => {
    const r = traceImage(picture(), { ...settings, removeBg: true }, { width: 40, height: 40 });
    expect(r.removed).toBe('#ffffff');
    expect(r.colors).toBe(1);
    expect(r.svg).not.toContain('#ffffff');
    expect(r.svg).toMatch(/fill="#d[0-9a-f]{5}"/);
  });

  it('turns everything black or white in b&w mode', () => {
    const r = traceImage(picture(), { ...presets.bw, removeBg: true }, { width: 40, height: 40 });
    expect(r.svg).toContain('fill="#000000"');
    expect(r.colors).toBe(1);
  });

  it('returns an empty svg for a fully transparent image', () => {
    const img = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    const r = traceImage(img, settings, { width: 8, height: 8 });
    expect(r.paths).toBe(0);
    expect(r.svg).toContain('<svg');
  });
});

describe('matchPreset', () => {
  it('recognises presets and custom tweaks', () => {
    expect(matchPreset({ ...presets.detailed, removeBg: true })).toBe('detailed');
    expect(matchPreset({ ...presets.logo, colors: 7, removeBg: false })).toBeUndefined();
  });
});

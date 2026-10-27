import { describe as group, expect, it } from 'vitest';
import { extractPalette } from '../../src/tools/lib/palette';
import { describe, hsl, nearestNamed, oklch, parseColor, toHex } from '../../src/tools/lib/image-color-picker/color';
import { paletteCode, percent } from '../../src/tools/lib/image-color-picker/export';

/** an RGBA buffer made of runs: [[r, g, b, a], pixelCount] */
function pixels(runs: [[number, number, number, number], number][]) {
  const out: number[] = [];
  for (const [rgba, n] of runs) for (let i = 0; i < n; i++) out.push(...rgba);
  return new Uint8ClampedArray(out);
}

group('extractPalette', () => {
  it('finds two flat colors with their shares, most common first', () => {
    const p = extractPalette(pixels([[[20, 40, 200, 255], 300], [[250, 200, 90, 255], 700]]), 5);
    expect(p).toEqual([
      { r: 250, g: 200, b: 90, share: 0.7 },
      { r: 20, g: 40, b: 200, share: 0.3 },
    ]);
  });

  it('groups near shades and keeps distinct colors apart', () => {
    const p = extractPalette(
      pixels([[[200, 30, 30, 255], 200], [[204, 34, 28, 255], 200], [[30, 160, 60, 255], 300], [[34, 164, 64, 255], 100], [[240, 240, 240, 255], 200]]),
      3,
    );
    expect(p).toHaveLength(3);
    expect(p.map((s) => s.share)).toEqual([0.4, 0.4, 0.2]);
    expect(p.map((s) => s.r).sort((a, b) => a - b)).toEqual([31, 202, 240]);
  });

  it('ignores transparent pixels', () => {
    const p = extractPalette(pixels([[[0, 0, 0, 0], 900], [[10, 120, 90, 255], 100]]), 6);
    expect(p).toEqual([{ r: 10, g: 120, b: 90, share: 1 }]);
  });

  it('handles empty input and is deterministic', () => {
    expect(extractPalette(new Uint8ClampedArray(0), 5)).toEqual([]);
    const data = new Uint8ClampedArray(4000).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
    const a = extractPalette(data, 8);
    expect(a).toEqual(extractPalette(data, 8));
    expect(a.length).toBeLessThanOrEqual(8);
    expect(a.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 10);
  });
});

group('color formats', () => {
  it('formats hex, rgb, hsl and oklch', () => {
    const d = describe({ r: 255, g: 210, b: 94, a: 255 });
    expect(d.hex).toBe('#ffd25e');
    expect(d.rgb).toBe('rgb(255, 210, 94)');
    expect(d.hsl).toBe('hsl(43, 100%, 68%)');
    expect(d.oklch).toMatch(/^oklch\(8\d\.\d% 0\.1\d\d \d+(\.\d)?\)$/);
  });

  it('matches reference OKLCH values', () => {
    const red = oklch({ r: 255, g: 0, b: 0 });
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
    expect(oklch({ r: 255, g: 255, b: 255 })).toEqual({ l: expect.closeTo(1, 4), c: expect.closeTo(0, 4), h: 0 });
  });

  it('computes hsl hues around the wheel', () => {
    expect(hsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 });
    expect(hsl({ r: 255, g: 0, b: 128 }).h).toBeCloseTo(329.9, 1);
    expect(hsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: expect.closeTo(50.2, 1) });
  });

  it('includes alpha only when the pixel is see-through', () => {
    const d = describe({ r: 0, g: 0, b: 0, a: 128 });
    expect(d.hex).toBe('#00000080');
    expect(d.rgb).toBe('rgba(0, 0, 0, 0.5)');
    expect(d.hsl).toBe('hsla(0, 0%, 0%, 0.5)');
    expect(d.oklch).toBe('oklch(0% 0 0 / 0.5)');
  });

  it('finds the nearest CSS color name', () => {
    expect(nearestNamed({ r: 255, g: 0, b: 0 })).toEqual({ name: 'red', hex: '#ff0000', exact: true });
    expect(nearestNamed({ r: 70, g: 131, b: 181 })).toMatchObject({ name: 'steelblue', exact: false });
  });

  it('parses hex and rgb strings', () => {
    expect(parseColor('#FA0')).toEqual({ r: 255, g: 170, b: 0, a: 255 });
    expect(parseColor('#11223380')).toEqual({ r: 17, g: 34, b: 51, a: 128 });
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 255 });
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 128 });
    expect(parseColor('banana')).toBeNull();
    expect(toHex({ r: 1, g: 2, b: 3 })).toBe('#010203');
  });
});

group('palette export', () => {
  const colors = [
    { r: 255, g: 0, b: 0, share: 0.6 },
    { r: 0, g: 0, b: 255, share: 0.4 },
  ];

  it('writes CSS variables and Tailwind snippets', () => {
    expect(paletteCode(colors, 'css')).toBe(':root {\n  --palette-1: #ff0000; /* red */\n  --palette-2: #0000ff; /* blue */\n}');
    expect(paletteCode(colors, 'tailwind4')).toContain('--color-palette-2: #0000ff;');
    expect(paletteCode(colors, 'tailwind3')).toContain("          1: '#ff0000', /* red */");
  });

  it('writes JSON with every format', () => {
    const json = JSON.parse(paletteCode(colors, 'json'));
    expect(json[0]).toEqual({ hex: '#ff0000', rgb: [255, 0, 0], hsl: 'hsl(0, 100%, 50%)', oklch: expect.stringMatching(/^oklch\(62\.8% 0\.25[78] 29\.\d\)$/), name: 'red', percent: 60 });
  });

  it('never shows a sliver as 0%', () => {
    expect(percent(0.001)).toBe('<1%');
    expect(percent(0.426)).toBe('43%');
  });
});

import { describe, expect, it } from 'vitest';
import {
  clip, deltaEOK, fromCmyk, fromHsl, fromHsv, fromHwb, fromLab, fromLch, fromOklab, fromOklch, fromP3,
  inGamut, to8bit, toCmyk, toGamut, toHsl, toHsv, toHwb, toLab, toLch, toOklab, toOklch, toP3, type Color, type Vec3,
} from '../../src/tools/lib/color/convert';
import { parseColor } from '../../src/tools/lib/color/parse';
import { formatAll, formatLabels, toHex } from '../../src/tools/lib/color/format';
import { apca, apcaUse, composite, contrastRatio, readableInk, resolvePair, wcagChecks } from '../../src/tools/lib/color/contrast';
import { scaleCode, shades, STEPS } from '../../src/tools/lib/color/scale';
import { simulate } from '../../src/tools/lib/color/cvd';

const rgb = (r: number, g: number, b: number, alpha = 1): Color => ({ r: r / 255, g: g / 255, b: b / 255, alpha });
const hex = (s: string) => {
  const c = parseColor(s);
  if (!c) throw new Error(`could not parse ${s}`);
  return c;
};
const bytes = (s: string) => to8bit(hex(s));
const near = (a: number[], b: number[], tol: number) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(tol));

// a fixed spread of colors across the sRGB cube, including the corners
const SAMPLES: Color[] = [];
for (const r of [0, 37, 128, 200, 255]) for (const g of [0, 90, 171, 255]) for (const b of [0, 64, 222, 255]) SAMPLES.push(rgb(r, g, b));
// plus a few hundred scattered ones (fixed LCG, so failures are reproducible)
let seed = 7;
const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256;
for (let i = 0; i < 400; i++) SAMPLES.push(rgb(next(), next(), next()));

describe('parseColor', () => {
  it('reads hex in every length, with or without #', () => {
    expect(bytes('#f80')).toEqual([255, 136, 0]);
    expect(bytes('ff8800')).toEqual([255, 136, 0]);
    expect(hex('#ff880080').alpha).toBeCloseTo(128 / 255);
    expect(hex('#f808').alpha).toBeCloseTo(136 / 255);
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('#ggg')).toBeNull();
  });

  it('reads named colors, including the alternate spellings', () => {
    expect(bytes('tomato')).toEqual([255, 99, 71]);
    expect(bytes('  RebeccaPurple ')).toEqual([102, 51, 153]);
    expect(bytes('grey')).toEqual([128, 128, 128]);
    expect(bytes('aqua')).toEqual([0, 255, 255]);
    expect(hex('transparent').alpha).toBe(0);
    expect(parseColor('notacolor')).toBeNull();
  });

  it('reads rgb() in legacy, modern and percentage forms', () => {
    expect(bytes('rgb(255, 136, 0)')).toEqual([255, 136, 0]);
    expect(bytes('rgb(255 136 0)')).toEqual([255, 136, 0]);
    expect(bytes('rgb(100% 50% 0%)')).toEqual([255, 128, 0]);
    expect(hex('rgba(255, 136, 0, 0.5)').alpha).toBe(0.5);
    expect(hex('rgb(255 136 0 / 25%)').alpha).toBe(0.25);
    expect(bytes('rgb(300, -5, 0)')).toEqual([255, 0, 0]);
    expect(bytes('255, 136, 0')).toEqual([255, 136, 0]);
    expect(bytes('rgb(none 136 0);')).toEqual([0, 136, 0]);
    expect(parseColor('rgb(1, 2)')).toBeNull();
    expect(parseColor('rgb(1 2 3 / 1 / 2)')).toBeNull();
    expect(parseColor('rgb(10deg 2 3)')).toBeNull();
  });

  it('rejects values that overflow the math instead of returning NaN', () => {
    expect(parseColor('hsl(1e999 50% 50%)')).toBeNull();
    expect(parseColor('lab(50 1e300 0)')).toBeNull();
    expect(parseColor('oklch(0.5 1e999 0)')).toBeNull();
    expect(bytes('rgb(1e999 0 0)')).toEqual([255, 0, 0]);
  });

  it('reads hsl() and hwb() with angle units', () => {
    expect(bytes('hsl(120, 100%, 25%)')).toEqual([0, 128, 0]);
    expect(bytes('hsl(0.5turn 100% 50%)')).toEqual([0, 255, 255]);
    expect(bytes(`hsl(${Math.PI}rad 100% 50%)`)).toEqual([0, 255, 255]);
    expect(bytes('hsla(-120, 100%, 50%, .5)')).toEqual([0, 0, 255]);
    expect(bytes('hwb(0 0% 0%)')).toEqual([255, 0, 0]);
    expect(bytes('hwb(90 60% 60%)')).toEqual([128, 128, 128]);
    expect(parseColor('hsl(10%, 50%, 50%)')).toBeNull();
  });

  it('reads lab, lch, oklab, oklch and color() spaces', () => {
    expect(bytes('lab(54.29% 80.82 69.9)')).toEqual([255, 0, 0]);
    expect(bytes('lch(54.29 106.84 40.85)')).toEqual([255, 0, 0]);
    expect(bytes('oklab(62.8% 0.2249 0.1258)')).toEqual([255, 0, 0]);
    expect(bytes('oklch(0.628 0.2577 29.23)')).toEqual([255, 0, 0]);
    expect(bytes('oklch(62.8% 64.4% 29.23deg)')).toEqual([255, 0, 0]);
    expect(bytes('oklch(100% 0 0)')).toEqual([255, 255, 255]);
    expect(bytes('color(srgb 1 0.5 0)')).toEqual([255, 128, 0]);
    expect(bytes('color(srgb-linear 1 0.2158605 0)')).toEqual([255, 128, 0]);
    expect(parseColor('color(rec2020 1 0 0)')).toBeNull();
  });

  it('reads cmyk as percentages or 0–1 numbers', () => {
    expect(bytes('cmyk(0%, 47%, 100%, 0%)')).toEqual([255, 135, 0]);
    expect(bytes('cmyk(0, 47, 100, 0)')).toEqual([255, 135, 0]);
    expect(bytes('device-cmyk(0 0.47 1 0)')).toEqual([255, 135, 0]);
    expect(bytes('cmyk(0, 0, 0, 100)')).toEqual([0, 0, 0]);
  });
});

describe('conversions', () => {
  it('matches reference values for pure red', () => {
    const red = rgb(255, 0, 0);
    near(toOklch(red), [0.62796, 0.25768, 29.234], 0.0005);
    near(toLab(red), [54.29, 80.81, 69.89], 0.05);
    near(toLch(red), [54.29, 106.84, 40.85], 0.05);
    near(toHsl(red), [0, 100, 50], 1e-9);
    near(toCmyk(red), [0, 1, 1, 0], 1e-9);
    near(toP3(red), [0.9175, 0.2003, 0.1386], 0.0005);
  });

  it('gives white L=1 and no chroma', () => {
    const [L, C, H] = toOklch(rgb(255, 255, 255));
    expect(L).toBeCloseTo(1, 4);
    expect(C).toBeLessThan(1e-4);
    expect(H).toBe(0);
    near(toLab(rgb(255, 255, 255)), [100, 0, 0], 0.01);
  });

  const roundTrips: [string, (c: Color) => Vec3, (v: Vec3) => Color][] = [
    ['oklab', toOklab, fromOklab],
    ['oklch', toOklch, fromOklch],
    ['lab', toLab, fromLab],
    ['lch', toLch, fromLch],
    ['hsl', toHsl, fromHsl],
    ['hwb', toHwb, fromHwb],
    ['hsv', toHsv, fromHsv],
    ['display-p3', toP3, fromP3],
  ];
  it.each(roundTrips)('round-trips through %s', (_, to, from) => {
    for (const c of SAMPLES) {
      const back = from(to(c));
      near([back.r, back.g, back.b], [c.r, c.g, c.b], 1e-6);
    }
  });

  it('round-trips through cmyk', () => {
    for (const c of SAMPLES) {
      const back = fromCmyk(toCmyk(c));
      near([back.r, back.g, back.b], [c.r, c.g, c.b], 1e-9);
    }
  });

  it('round-trips colors outside sRGB through the wide spaces', () => {
    const wide = fromOklch([0.7, 0.3, 150]);
    expect(inGamut(wide)).toBe(false);
    near(toOklch(fromLab(toLab(wide))), [0.7, 0.3, 150], 1e-6);
    near(toOklch(fromP3(toP3(wide))), [0.7, 0.3, 150], 1e-6);
  });
});

describe('gamut mapping', () => {
  it('leaves sRGB colors alone', () => {
    for (const c of SAMPLES) expect(toGamut(c)).toEqual(clip(c));
    expect(inGamut({ r: 1.001, g: -0.001, b: 0.5, alpha: 1 })).toBe(true);
  });

  it('pulls a vivid oklch green into sRGB, keeping lightness and hue', () => {
    const wide = hex('oklch(70% 0.4 150)');
    expect(inGamut(wide)).toBe(false);
    const mapped = toGamut(wide);
    expect(inGamut(mapped, 0)).toBe(true);
    const [L, C, H] = toOklch(mapped);
    expect(L).toBeCloseTo(0.7, 1);
    expect(Math.abs(H - 150)).toBeLessThan(3);
    expect(C).toBeLessThan(0.4);
    // a naive per-channel clip shifts the hue much more
    expect(Math.abs(H - 150)).toBeLessThan(Math.abs(toOklch(clip(wide))[2] - 150));
  });

  it('maps display-p3 red to a red, and too-bright or too-dark colors to white or black', () => {
    const p3 = hex('color(display-p3 1 0 0)');
    expect(inGamut(p3)).toBe(false);
    const [r, g, b] = to8bit(p3);
    expect(r).toBe(255);
    expect(g + b).toBeLessThan(60);
    expect(to8bit(fromOklch([1, 0.2, 90]))).toEqual([255, 255, 255]);
    expect(to8bit(fromOklch([0, 0.2, 90]))).toEqual([0, 0, 0]);
  });
});

describe('formatAll', () => {
  it('writes every format as valid CSS', () => {
    const f = formatAll(rgb(255, 136, 0));
    expect(f.hex).toBe('#ff8800');
    expect(f.rgb).toBe('rgb(255, 136, 0)');
    expect(f.hsl).toBe('hsl(32, 100%, 50%)');
    expect(f.hwb).toBe('hwb(32 0% 0%)');
    expect(f.cmyk).toBe('cmyk(0%, 47%, 100%, 0%)');
    expect(f.oklch).toMatch(/^oklch\(\d+(\.\d+)?% 0\.\d+ \d+(\.\d+)?\)$/);
    expect(formatLabels.map(([k]) => k).sort()).toEqual(Object.keys(f).sort());
  });

  it('includes alpha in the right syntax for each format', () => {
    const f = formatAll(rgb(255, 136, 0, 0.5));
    expect(f.hex).toBe('#ff880080');
    expect(f.rgb).toBe('rgba(255, 136, 0, 0.5)');
    expect(f.hsl).toBe('hsla(32, 100%, 50%, 0.5)');
    expect(f.oklch).toMatch(/ \/ 0\.5\)$/);
    expect(f.p3).toMatch(/^color\(display-p3 [\d. ]+ \/ 0\.5\)$/);
  });

  it('parses back to the same 8-bit color from every format', () => {
    for (const c of SAMPLES) {
      const want = to8bit(c);
      const f = formatAll(c);
      for (const [key] of formatLabels) {
        const back = to8bit(hex(f[key]));
        expect({ key, back }).toEqual({ key, back: key === 'cmyk' ? back : want });
        if (key === 'cmyk') near(back, want, 2);
      }
    }
  });

  it('keeps the exact wide-gamut value but shows the mapped color as hex', () => {
    const f = formatAll(hex('oklch(70% 0.4 150)'));
    expect(f.oklch).toBe('oklch(70% 0.4 150)');
    expect(f.hex).toBe(toHex(toGamut(hex('oklch(70% 0.4 150)'))));
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(21, 5);
    expect(contrastRatio(rgb(119, 119, 119), rgb(255, 255, 255))).toBeCloseTo(4.48, 2);
    expect(contrastRatio(rgb(9, 9, 9), rgb(9, 9, 9))).toBe(1);
  });

  it('applies the WCAG 2.2 thresholds', () => {
    const at = (r: number) => Object.fromEntries(wcagChecks(r).map((c) => [c.id, c.pass]));
    expect(at(4.48)).toEqual({ aa: false, 'aa-large': true, aaa: false, 'aaa-large': false, ui: true });
    expect(at(4.5)).toEqual({ aa: true, 'aa-large': true, aaa: false, 'aaa-large': true, ui: true });
    expect(at(7.1)).toEqual({ aa: true, 'aa-large': true, aaa: true, 'aaa-large': true, ui: true });
  });

  it('matches the APCA reference values', () => {
    expect(apca(hex('#000'), hex('#fff'))).toBeCloseTo(106.04, 1);
    expect(apca(hex('#fff'), hex('#000'))).toBeCloseTo(-107.88, 1);
    expect(apca(hex('#888'), hex('#fff'))).toBeCloseTo(63.06, 1);
    expect(apca(hex('#fff'), hex('#888'))).toBeCloseTo(-68.54, 1);
    expect(apca(hex('#000'), hex('#aaa'))).toBeCloseTo(58.15, 1);
    expect(apca(hex('#aaa'), hex('#000'))).toBeCloseTo(-56.24, 1);
    expect(apca(hex('#777'), hex('#777'))).toBe(0);
    expect(apcaUse(-95)).toMatch(/preferred/i);
    expect(apcaUse(10)).toMatch(/not readable/i);
  });

  it('blends see-through colors before measuring', () => {
    const half = composite(rgb(0, 0, 0, 0.5), rgb(255, 255, 255));
    near([half.r, half.g, half.b], [0.5, 0.5, 0.5], 1e-9);
    const pair = resolvePair(rgb(0, 0, 0), rgb(0, 0, 0, 0));
    expect(contrastRatio(pair.text, pair.bg)).toBeCloseTo(21, 5);
  });

  it('picks readable ink', () => {
    expect(readableInk(hex('#ffd25e'))).toBe('black');
    expect(readableInk(hex('navy'))).toBe('white');
    // see-through colors are judged on what's underneath
    expect(readableInk(hex('transparent'))).toBe('black');
    expect(readableInk(hex('transparent'), rgb(37, 36, 33))).toBe('white');
  });
});

describe('shades', () => {
  it('puts the color itself on its nearest step and keeps the scale in order', () => {
    const c = hex('oklch(63.7% 0.237 25.331)');
    const { anchor, shades: list } = shades(c);
    expect(list.map((s) => s.step)).toEqual([...STEPS]);
    expect(STEPS[anchor]).toBe(500);
    expect(list[anchor].hex).toBe(toHex(c));
    const lightness = list.map((s) => toOklch(s.color)[0]);
    for (let i = 1; i < lightness.length; i++) expect(lightness[i]).toBeLessThan(lightness[i - 1]);
    for (const s of list) expect(inGamut(s.color, 0)).toBe(true);
    // with the color already on the curve, 600 follows Tailwind's lightness
    expect(Math.abs(lightness[6] - 0.577)).toBeLessThan(0.01);
  });

  it('anchors very light and very dark colors at the ends', () => {
    expect(STEPS[shades(hex('#fafafa')).anchor]).toBe(50);
    expect(STEPS[shades(hex('#0a0a0a')).anchor]).toBe(950);
    const { shades: black } = shades(hex('#000'));
    expect(black[10].hex).toBe('#000000');
    expect(black[0].hex).not.toBe('#000000');
  });

  it('writes CSS, Tailwind and JSON', () => {
    const { shades: list } = shades(hex('#3b82f6'));
    expect(scaleCode(list, 'css', 'hex')).toMatch(/^:root \{\n {2}--color-brand-50: #[0-9a-f]{6};/);
    expect(scaleCode(list, 'tailwind', 'oklch', 'sky')).toMatch(/^@theme \{\n {2}--color-sky-50: oklch\(/);
    expect(Object.keys(JSON.parse(scaleCode(list, 'json', 'hex')))).toHaveLength(11);
  });
});

describe('color blindness simulation', () => {
  it('leaves grays unchanged', () => {
    for (const v of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      expect(to8bit(simulate(rgb(128, 128, 128), v))).toEqual([128, 128, 128]);
    }
  });

  it('makes red and green harder to tell apart for red-green types', () => {
    const red = rgb(220, 40, 40);
    const green = rgb(40, 160, 40);
    const before = deltaEOK(red, green);
    expect(deltaEOK(simulate(red, 'protanopia'), simulate(green, 'protanopia'))).toBeLessThan(before * 0.7);
    expect(deltaEOK(simulate(red, 'deuteranopia'), simulate(green, 'deuteranopia'))).toBeLessThan(before * 0.7);
  });

  it('keeps alpha', () => {
    expect(simulate(rgb(10, 200, 30, 0.4), 'tritanopia').alpha).toBe(0.4);
  });
});

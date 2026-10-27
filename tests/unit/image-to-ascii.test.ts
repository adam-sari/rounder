import { describe, expect, it } from 'vitest';
import { RAMPS, fitCell, gridSize, rampFor, toAscii, toHtml, toText } from '../../src/tools/lib/ascii';
import type { Pixels } from '../../src/tools/lib/pixel';

/** w × h image filled by fn(x, y) → gray value, or [r, g, b, a] */
function img(w: number, h: number, fn: (x: number, y: number) => number | number[]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      data.set(typeof v === 'number' ? [v, v, v, 255] : v, (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

describe('ramps', () => {
  it('has a 70-level detailed ramp with no repeats', () => {
    expect(RAMPS.detailed.length).toBe(70);
    expect(new Set(RAMPS.detailed).size).toBe(70);
  });

  it('splits custom sets by code point and falls back when too short', () => {
    expect(rampFor({ charset: 'custom', custom: ' ·🙂' })).toEqual([' ', '·', '🙂']);
    expect(rampFor({ charset: 'custom', custom: 'x' })).toEqual(Array.from(RAMPS.standard));
  });
});

describe('gridSize', () => {
  it('halves the row count to make up for tall character cells', () => {
    expect(gridSize(200, 100, 80)).toEqual({ cols: 80, rows: 20 });
    expect(gridSize(100, 100, 40)).toEqual({ cols: 40, rows: 20 });
    expect(gridSize(1000, 1, 40).rows).toBe(1);
  });
});

describe('toAscii', () => {
  const half = img(40, 20, (x) => (x < 20 ? 0 : 255)); // black left, white right

  it('puts dense characters on bright areas for a dark background', () => {
    const art = toAscii(half, { cols: 10, charset: 'standard', background: 'dark' });
    expect(art.rows).toBe(3);
    expect(toText(art).split('\n')[0]).toBe('     @@@@@');
  });

  it('flips for a light background and flips back with invert', () => {
    const light = toAscii(half, { cols: 10, charset: 'standard', background: 'light' });
    expect(light.chars.slice(0, 10).join('')).toBe('@@@@@     ');
    const inverted = toAscii(half, { cols: 10, charset: 'standard', background: 'light', invert: true });
    expect(inverted.chars.slice(0, 10).join('')).toBe('     @@@@@');
  });

  it('trims trailing spaces from the text output only', () => {
    const art = toAscii(img(20, 10, (x) => (x < 10 ? 255 : 0)), { cols: 4, charset: 'blocks', background: 'dark' });
    expect(art.chars.slice(0, 4).join('')).toBe('██  ');
    expect(toText(art).split('\n')[0]).toBe('██');
  });

  it('applies brightness and contrast', () => {
    const gray = img(10, 10, () => 128);
    const pick = (o: object) => toAscii(gray, { cols: 2, charset: 'standard', background: 'dark', ...o }).chars[0];
    expect(pick({})).toBe('+');
    expect(pick({ brightness: 100 })).toBe('@');
    expect(pick({ brightness: -100 })).toBe(' ');
    expect(pick({ contrast: 100 })).toBe('+');
  });

  it('treats transparent pixels as the background', () => {
    const clear = img(10, 10, () => [255, 255, 255, 0]);
    expect(toAscii(clear, { cols: 2, charset: 'standard', background: 'dark' }).chars[0]).toBe(' ');
    expect(toAscii(clear, { cols: 2, charset: 'standard', background: 'light' }).chars[0]).toBe(' ');
  });

  it('builds braille characters from a 2 × 4 dot grid', () => {
    const white = toAscii(img(20, 20, () => 255), { cols: 2, charset: 'braille', background: 'dark' });
    expect(white.chars[0]).toBe('⣿');
    const black = toAscii(img(20, 20, () => 0), { cols: 2, charset: 'braille', background: 'dark' });
    expect(black.chars[0]).toBe('⠀');
    // only the left dot column lit
    const left = toAscii(img(4, 8, (x) => (x % 2 === 0 ? 255 : 0)), { cols: 2, charset: 'braille', background: 'dark' });
    expect(left.chars[0]).toBe(String.fromCharCode(0x2800 | 0x01 | 0x02 | 0x04 | 0x40));
  });

  it('keeps the average color of each cell', () => {
    const red = toAscii(img(10, 10, () => [200, 10, 20, 255]), { cols: 2, charset: 'standard', background: 'dark' });
    expect(Array.from(red.colors.slice(0, 3))).toEqual([200, 10, 20]);
  });
});

describe('toHtml', () => {
  it('escapes markup and merges same-colored runs', () => {
    const art = { cols: 3, rows: 1, chars: ['<', '&', 'a'], colors: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 255]) };
    expect(toHtml(art, 'dark', true)).toContain('<span style="color:#ff0000">&lt;&amp;</span><span style="color:#0000ff">a</span>');
    expect(toHtml(art, 'light', false)).toContain('>&lt;&amp;a\n</pre>');
  });
});

describe('fitCell', () => {
  it('keeps the wanted cell size for ordinary art', () => {
    expect(fitCell(100, 40, 14)).toBe(14);
  });

  it('shrinks cells so very tall art still fits in a canvas', () => {
    const cell = fitCell(300, 3000, 8, 2);
    const w = (300 + 4) * cell;
    const h = (3000 * 2 + 4) * cell;
    expect(cell).toBeLessThan(8);
    expect(Math.max(w, h)).toBeLessThanOrEqual(16384);
    expect(w * h).toBeLessThanOrEqual(4096 * 4096);
  });
});

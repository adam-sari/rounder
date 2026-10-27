import { describe, expect, it } from 'vitest';
import { QUALITIES, alphaBounds, fitUnder, hasTransparency } from '@/tools/lib/youtube-thumbnail-maker/pixels';
import { H, W, boxOf, gradientLine, newImage, newShape, resized, sizeLimits, snapCenter } from '@/tools/lib/youtube-thumbnail-maker/scene';
import { burstPath, shapes } from '@/tools/lib/youtube-thumbnail-maker/shapes';
import { PILL_X, fileNameFor, layoutText, parseMarkup, type TextStyle } from '@/tools/lib/youtube-thumbnail-maker/text';
import def from '@/tools/defs/youtube-thumbnail-maker';

// monospace stand-in: every character is half the font size wide
const measure = (s: string, px: number) => s.length * px * 0.5;
const style = (over: Partial<TextStyle> = {}): TextStyle => ({ size: 100, lineHeight: 1, outline: 0, highlight: 'none', upper: false, align: 'center', ...over });

describe('parseMarkup', () => {
  it('marks words between asterisks', () => {
    expect(parseMarkup('this is *huge* news')).toEqual([[
      { text: 'this is ', mark: false },
      { text: 'huge', mark: true },
      { text: ' news', mark: false },
    ]]);
  });

  it('keeps an unpaired asterisk as text', () => {
    expect(parseMarkup('5*3 = 15')).toEqual([[{ text: '5*3 = 15', mark: false }]]);
    expect(parseMarkup('*a* b*c')).toEqual([[{ text: 'a', mark: true }, { text: ' b*c', mark: false }]]);
  });

  it('works line by line and keeps empty lines', () => {
    expect(parseMarkup('*one*\n\ntwo')).toEqual([[{ text: 'one', mark: true }], [], [{ text: 'two', mark: false }]]);
  });
});

describe('layoutText', () => {
  it('centers lines around the layer center', () => {
    const l = layoutText('ab\nabcd', style(), measure, 0.7);
    expect(l.lines[0].x).toBe(-50);
    expect(l.lines[1].x).toBe(-100);
    expect(l.width).toBe(200);
    expect(l.height).toBe(200);
    // capitals of the first line are centered in its 100px line box
    expect(l.lines[0].middle).toBe(-50);
    expect(l.lines[0].baseline).toBe(-50 + 35);
  });

  it('aligns left and right inside the widest line', () => {
    expect(layoutText('ab\nabcd', style({ align: 'left' }), measure, 0.7).lines[0].x).toBe(-100);
    expect(layoutText('ab\nabcd', style({ align: 'right' }), measure, 0.7).lines[0].x).toBe(0);
  });

  it('uppercases, and places runs one after another', () => {
    const l = layoutText('go *big*', style({ upper: true }), measure, 0.7);
    expect(l.lines[0].runs.map((r) => [r.text, r.mark, r.x])).toEqual([['GO ', false, -150], ['BIG', true, 0]]);
  });

  it('puts highlight boxes behind marked words only, trimmed of spaces', () => {
    const l = layoutText('a *bc* d', style({ highlight: 'marked' }), measure, 0.7);
    expect(l.pills).toHaveLength(1);
    const run = l.lines[0].runs[1];
    expect(l.pills[0].x).toBe(run.inkX - PILL_X * 100);
    expect(l.pills[0].width).toBe(100 + PILL_X * 200);
  });

  it('puts one highlight box behind each non-empty line', () => {
    const l = layoutText(' ab \n\ncd', style({ highlight: 'lines' }), measure, 0.7);
    expect(l.pills).toHaveLength(2);
    expect(l.pills[0].x).toBe(l.lines[0].runs[0].inkX - PILL_X * 100);
  });

  it('grows the hit box by the outline', () => {
    const l = layoutText('ab', style({ outline: 0.1 }), measure, 0.7);
    expect(l.width).toBe(100 + 20);
  });
});

describe('fileNameFor', () => {
  it('names the file after the headline', () => {
    expect(fileNameFor('This changed\n*Everything*!', 'jpg')).toBe('this-changed-everything-thumbnail.jpg');
    expect(fileNameFor('Café crème', 'png')).toBe('cafe-creme-thumbnail.png');
  });

  it('falls back to a plain name', () => {
    expect(fileNameFor(undefined, 'jpg')).toBe('thumbnail.jpg');
    expect(fileNameFor('🔥🔥', 'jpg')).toBe('thumbnail.jpg');
  });
});

describe('fitUnder', () => {
  it('stops at the first quality under the limit', async () => {
    const tried: number[] = [];
    const { blob, quality } = await fitUnder(500, async (q) => {
      tried.push(q);
      return new Blob([new Uint8Array(q * 7)]);
    });
    expect(quality).toBe(68);
    expect(blob.size).toBeLessThanOrEqual(500);
    expect(tried).toEqual(QUALITIES.slice(0, QUALITIES.indexOf(68) + 1));
  });

  it('returns the last attempt when nothing fits', async () => {
    const { quality } = await fitUnder(1, async (q) => new Blob([new Uint8Array(q)]));
    expect(quality).toBe(QUALITIES.at(-1));
  });
});

describe('pixels', () => {
  const rgba = (alphas: number[]) => new Uint8ClampedArray(alphas.flatMap((a) => [0, 0, 0, a]));

  it('spots transparency', () => {
    expect(hasTransparency(rgba([255, 255, 255, 0]), 1)).toBe(true);
    expect(hasTransparency(rgba([255, 255, 255, 255]), 1)).toBe(false);
  });

  it('finds the bounds of visible pixels', () => {
    // 3 × 3 with a visible pixel at (1,1) and (2,1)
    expect(alphaBounds(rgba([0, 0, 0, 0, 255, 255, 0, 0, 0]), 3, 3)).toEqual({ x: 1, y: 1, width: 2, height: 1 });
    expect(alphaBounds(rgba([0, 0, 0, 0]), 2, 2)).toBeNull();
  });
});

describe('scene geometry', () => {
  it('snaps to the canvas center lines', () => {
    expect(snapCenter(W / 2 + 4, 100)).toEqual({ x: W / 2, y: 100, sx: true, sy: false });
    expect(snapCenter(10, H / 2 - 3).sy).toBe(true);
  });

  it('resizes with the pointer distance, within limits', () => {
    expect(resized(100, 'text', 50, 100)).toBe(200);
    expect(resized(100, 'text', 50, 1)).toBe(sizeLimits.text[0]);
  });

  it('sizes boxes from the aspect and outline', () => {
    expect(boxOf({ ...newImage(1, 1, 'a.png', 0.5, 200), outline: 0.05 })).toEqual({ width: 220, height: 120 });
    const arrow = newShape(2, 'arrow');
    expect(boxOf({ ...arrow, outline: 0 }).height).toBeCloseTo((arrow.size * shapes.arrow.h) / shapes.arrow.w);
  });

  it('runs gradients corner to corner like css', () => {
    expect(gradientLine(90, 200, 100).map((n) => Math.round(n) + 0)).toEqual([0, 50, 200, 50]);
    const [x0, y0, x1, y1] = gradientLine(180, 200, 100);
    expect([x0, y0, x1, y1].map((n) => Math.round(n) + 0)).toEqual([100, 0, 100, 100]);
  });

  it('draws a closed burst with alternating radii', () => {
    const d = burstPath(4, 10, 5);
    expect(d.startsWith('M10.00 0.00')).toBe(true);
    expect(d.match(/L/g)).toHaveLength(7);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
  });
});

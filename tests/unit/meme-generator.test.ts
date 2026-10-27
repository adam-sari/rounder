import { describe, expect, it } from 'vitest';
import { EDGE, LINE_HEIGHT, STROKE, layoutBox, layoutCaption, lineX, wrapLines, type TextBox } from '@/tools/lib/meme-generator/layout';

// monospace stand-in: every character is half the font size wide
const measure = (s: string, px: number) => s.length * px * 0.5;
const at = (px: number) => (s: string) => measure(s, px);

const box = (over: Partial<TextBox> = {}): TextBox => ({
  text: 'hello world', anchor: 'free', x: 0.5, y: 0.5, width: 1, size: 0.1,
  color: '#fff', stroke: false, strokeColor: '#000', align: 'center', upper: false, ...over,
});

describe('wrapLines', () => {
  it('wraps greedily at word boundaries', () => {
    expect(wrapLines('one two three four', 9, (s) => s.length)).toEqual(['one two', 'three', 'four']);
  });

  it('keeps manual line breaks and blank lines', () => {
    expect(wrapLines('a\n\nb', 100, (s) => s.length)).toEqual(['a', '', 'b']);
  });

  it('breaks a word that cannot fit on any line', () => {
    expect(wrapLines('abcdefghij xy', 4, (s) => s.length)).toEqual(['abcd', 'efgh', 'ij', 'xy']);
  });

  it('returns one empty line for empty text', () => {
    expect(wrapLines('', 10, (s) => s.length)).toEqual(['']);
  });
});

describe('layoutBox', () => {
  it('sizes the font from the image width and uppercases on request', () => {
    const l = layoutBox(box({ text: 'hi', upper: true }), 1000, 800, measure);
    expect(l.px).toBe(100);
    expect(l.lines).toEqual(['HI']);
    expect(l.height).toBeCloseTo(100 * LINE_HEIGHT);
  });

  it('pins classic text to the top and bottom edges', () => {
    const edge = EDGE * 800;
    expect(layoutBox(box({ anchor: 'top' }), 1000, 800, measure).top).toBeCloseTo(edge);
    const bottom = layoutBox(box({ anchor: 'bottom' }), 1000, 800, measure);
    expect(bottom.top + bottom.height).toBeCloseTo(800 - edge);
  });

  it('centres free boxes on their position', () => {
    const l = layoutBox(box({ x: 0.25, y: 0.5, width: 0.5 }), 1000, 800, measure);
    expect(l.left).toBe(0);
    expect(l.top + l.height / 2).toBeCloseTo(400);
  });

  it('shrinks the font so the longest word fits, but not below half size', () => {
    // 20 chars at 100px = 1000px wide, box is 500px
    const fit = layoutBox(box({ text: 'a'.repeat(20), width: 0.5 }), 1000, 1000, measure);
    expect(fit.px).toBeCloseTo(50);
    expect(fit.lines).toHaveLength(1);
    const floor = layoutBox(box({ text: 'a'.repeat(40), width: 0.5 }), 1000, 1000, measure);
    expect(floor.px).toBe(50);
    expect(floor.lines.length).toBeGreaterThan(1);
  });

  it('leaves room for the outline when wrapping', () => {
    const l = layoutBox(box({ text: 'aaaa aaaa', stroke: true, width: 0.4 }), 1000, 1000, measure);
    expect(l.strokeWidth).toBeCloseTo(l.px * STROKE);
    for (const line of l.lines) expect(at(l.px)(line)).toBeLessThanOrEqual(l.width - l.strokeWidth);
  });
});

describe('layoutCaption', () => {
  it('grows the bar with each wrapped line', () => {
    const one = layoutCaption('short', 0.05, 1000, measure);
    const many = layoutCaption('a much longer caption that will need to wrap over several lines here', 0.05, 1000, measure);
    expect(many.lines.length).toBeGreaterThan(1);
    expect(Math.abs(many.height - one.height - (many.lines.length - 1) * many.lineHeight)).toBeLessThanOrEqual(1);
  });
});

describe('lineX', () => {
  it('anchors text by alignment', () => {
    expect(lineX('left', 100, 200, 5)).toBe(105);
    expect(lineX('center', 100, 200, 5)).toBe(200);
    expect(lineX('right', 100, 200, 5)).toBe(295);
  });
});

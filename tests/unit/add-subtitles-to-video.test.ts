import { describe, expect, it } from 'vitest';
import {
  captionAt,
  cleanText,
  decodeText,
  formatTimestamp,
  hasTimings,
  isValidCue,
  parseSubtitles,
  parseTimestamp,
  shiftCues,
  spreadText,
  toSrt,
  toVtt,
} from '@/tools/lib/subtitles/format';
import { defaultStyle, drawCaption, EDGE, layoutCaption, LINE_HEIGHT, wrapLines, type CaptionStyle } from '@/tools/lib/subtitles/layout';

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello there.

2
00:00:04,250 --> 00:00:06,000
<i>Second</i> line
spans two rows
`;

describe('timestamps', () => {
  it('parses comma and dot milliseconds', () => {
    expect(parseTimestamp('00:00:01,500')).toBe(1.5);
    expect(parseTimestamp('00:00:01.500')).toBe(1.5);
  });

  it('allows missing hours (WebVTT short form)', () => {
    expect(parseTimestamp('01:02.250')).toBe(62.25);
  });

  it('allows hours above 99', () => {
    expect(parseTimestamp('123:00:00,000')).toBe(442800);
  });

  it('treats short fractions as decimals and tolerates missing ms', () => {
    expect(parseTimestamp('00:00:02,5')).toBe(2.5);
    expect(parseTimestamp('00:00:02')).toBe(2);
  });

  it('rejects nonsense', () => {
    expect(parseTimestamp('soon')).toBeNull();
    expect(parseTimestamp('1:2:3:4')).toBeNull();
  });

  it('formats with either separator and rounds to the millisecond', () => {
    expect(formatTimestamp(3723.5)).toBe('01:02:03,500');
    expect(formatTimestamp(3723.5, '.')).toBe('01:02:03.500');
    expect(formatTimestamp(0.1 + 0.2)).toBe('00:00:00,300');
    expect(formatTimestamp(-4)).toBe('00:00:00,000');
  });

  it('keeps counting hours past 99', () => {
    expect(formatTimestamp(100 * 3600 + 1)).toBe('100:00:01,000');
  });
});

describe('cleanText', () => {
  it('strips HTML-style formatting tags', () => {
    expect(cleanText('<i>Hi</i> <b>there</b> <font color="#ff0000">you</font>')).toBe('Hi there you');
  });

  it('strips WebVTT voice, class and timestamp tags and ruby text', () => {
    expect(cleanText('<v Bob>Hey <c.yellow>you</c></v> <00:00:01.000>now')).toBe('Hey you now');
    expect(cleanText('<ruby>漢<rt>kan</rt></ruby>')).toBe('漢');
  });

  it('strips ASS override tags and turns \\N into a line break', () => {
    expect(cleanText('{\\an8}Top\\Nline')).toBe('Top\nline');
  });

  it('decodes entities after removing tags, so escaped brackets stay as text', () => {
    expect(cleanText('Fish &amp; chips &lt;3 &#233;&#x41;')).toBe('Fish & chips <3 éA');
    expect(cleanText('&lt;i&gt;literal&lt;/i&gt;')).toBe('<i>literal</i>');
  });

  it('leaves comparisons alone and drops lines that end up empty', () => {
    expect(cleanText('a < b > c')).toBe('a < b > c');
    expect(cleanText('  <i></i>  \n kept ')).toBe('kept');
  });
});

describe('parseSubtitles', () => {
  it('reads a plain SRT', () => {
    const r = parseSubtitles(SRT);
    expect(r.format).toBe('srt');
    expect(r.skipped).toBe(0);
    expect(r.cues).toEqual([
      { start: 1, end: 3.5, text: 'Hello there.' },
      { start: 4.25, end: 6, text: 'Second line\nspans two rows' },
    ]);
  });

  it('handles a BOM and CRLF line endings', () => {
    const r = parseSubtitles(`﻿${SRT.replace(/\n/g, '\r\n')}`);
    expect(r.cues).toHaveLength(2);
    expect(r.cues[1].text).toBe('Second line\nspans two rows');
  });

  it('handles old Mac CR line endings', () => {
    expect(parseSubtitles(SRT.replace(/\n/g, '\r')).cues).toHaveLength(2);
  });

  it('reads WebVTT with header text, NOTE, STYLE, ids, cue settings and short times', () => {
    const vtt = `WEBVTT - my film

STYLE
::cue { color: lime }

NOTE this is a comment
spanning lines

intro
00:01.000 --> 00:02.500 align:start line:0%
<v Ann>Hi!</v>

01:00:00.000 --> 01:00:01.000
Later`;
    const r = parseSubtitles(vtt);
    expect(r.format).toBe('vtt');
    expect(r.cues).toEqual([
      { start: 1, end: 2.5, text: 'Hi!' },
      { start: 3600, end: 3601, text: 'Later' },
    ]);
  });

  it('accepts dot milliseconds in SRT and SRT without index numbers', () => {
    const r = parseSubtitles('00:00:01.000 --> 00:00:02.000\nOne\n\n00:00:03,000-->00:00:04,000\nTwo');
    expect(r.cues.map((c) => c.text)).toEqual(['One', 'Two']);
  });

  it('keeps cue text that contains a blank line in an SRT', () => {
    const r = parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nFirst part\n\nsecond part\n\n2\n00:00:03,000 --> 00:00:04,000\nNext');
    expect(r.cues[0].text).toBe('First part\nsecond part');
    expect(r.cues[1].text).toBe('Next');
  });

  it('splits cues written without a blank line between them', () => {
    const r = parseSubtitles('1\n00:00:01,000 --> 00:00:02,000\nOne\n2\n00:00:03,000 --> 00:00:04,000\nTwo\nlines\n00:00:05,000 --> 00:00:06,000\nThree');
    expect(r.cues).toEqual([
      { start: 1, end: 2, text: 'One' },
      { start: 3, end: 4, text: 'Two\nlines' },
      { start: 5, end: 6, text: 'Three' },
    ]);
  });

  it('copes with extra blank lines and trailing whitespace', () => {
    const r = parseSubtitles('\n\n1\n00:00:01,000 --> 00:00:02,000   \nOne   \n\n\n\n \n2\n00:00:03,000 --> 00:00:04,000\nTwo\n\n\n');
    expect(r.cues.map((c) => c.text)).toEqual(['One', 'Two']);
  });

  it('skips empty, backwards and broken cues and counts them', () => {
    const r = parseSubtitles('1\n00:00:05,000 --> 00:00:04,000\nBackwards\n\n2\n00:00:06,000 --> 00:00:07,000\n<i></i>\n\n3\nbad --> times\nOops\n\n4\n00:00:08,000 --> 00:00:09,000\nGood');
    expect(r.cues).toEqual([{ start: 8, end: 9, text: 'Good' }]);
    expect(r.skipped).toBe(3);
  });

  it('sorts cues by start time', () => {
    const r = parseSubtitles('00:00:05,000 --> 00:00:06,000\nB\n\n00:00:01,000 --> 00:00:02,000\nA');
    expect(r.cues.map((c) => c.text)).toEqual(['A', 'B']);
  });

  it('handles hours above 99', () => {
    const r = parseSubtitles('1\n100:00:00,000 --> 100:00:01,500\nLong film');
    expect(r.cues[0]).toEqual({ start: 360000, end: 360001.5, text: 'Long film' });
  });

  it('returns nothing for text without timings', () => {
    expect(parseSubtitles('just some words').cues).toEqual([]);
  });
});

describe('serializing', () => {
  const cues = [
    { start: 1, end: 3.5, text: 'Hello there.' },
    { start: 4.25, end: 6, text: 'Fish & chips <3\n\n  second line ' },
  ];

  it('writes SRT with numbers and comma milliseconds', () => {
    expect(toSrt(cues)).toBe('1\n00:00:01,000 --> 00:00:03,500\nHello there.\n\n2\n00:00:04,250 --> 00:00:06,000\nFish & chips <3\nsecond line\n');
  });

  it('writes VTT with a header, dot milliseconds and escaped text', () => {
    expect(toVtt(cues)).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello there.\n\n00:00:04.250 --> 00:00:06.000\nFish &amp; chips &lt;3\nsecond line\n');
  });

  it('leaves out invalid cues and renumbers', () => {
    const out = toSrt([{ start: 2, end: 1, text: 'x' }, { start: 0, end: 1, text: '  ' }, { start: 1, end: 2, text: 'ok' }]);
    expect(out).toBe('1\n00:00:01,000 --> 00:00:02,000\nok\n');
  });

  it('round-trips through both formats', () => {
    const clean = parseSubtitles(SRT).cues;
    expect(parseSubtitles(toSrt(clean)).cues).toEqual(clean);
    expect(parseSubtitles(toVtt(clean)).cues).toEqual(clean);
    expect(parseSubtitles(toVtt(cues)).cues[1].text).toBe('Fish & chips <3\nsecond line');
  });

  it('isValidCue needs a positive length and some text', () => {
    expect(isValidCue({ start: 1, end: 2, text: 'a' })).toBe(true);
    expect(isValidCue({ start: 1, end: 1, text: 'a' })).toBe(false);
    expect(isValidCue({ start: 1, end: 2, text: ' \n ' })).toBe(false);
  });
});

describe('shiftCues', () => {
  const cues = [
    { id: 1, start: 0.5, end: 1.5, text: 'a' },
    { id: 2, start: 2, end: 3, text: 'b' },
  ];

  it('moves later and keeps extra fields', () => {
    expect(shiftCues(cues, 1.25)).toEqual([
      { id: 1, start: 1.75, end: 2.75, text: 'a' },
      { id: 2, start: 3.25, end: 4.25, text: 'b' },
    ]);
  });

  it('moves earlier, clamping at 0 and dropping cues that end before it', () => {
    expect(shiftCues(cues, -1.5)).toEqual([{ id: 2, start: 0.5, end: 1.5, text: 'b' }]);
    expect(shiftCues(cues, -1)).toEqual([
      { id: 1, start: 0, end: 0.5, text: 'a' },
      { id: 2, start: 1, end: 2, text: 'b' },
    ]);
  });

  it('avoids floating point drift', () => {
    expect(shiftCues([{ start: 0.1, end: 0.2, text: 'x' }], 0.2)[0]).toEqual({ start: 0.3, end: 0.4, text: 'x' });
  });
});

describe('spreadText and hasTimings', () => {
  it('spreads lines across the duration by length, end to end', () => {
    const cues = spreadText('A short line here\nA much longer second line goes right here', 10);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(0);
    expect(cues[1].start).toBe(cues[0].end);
    expect(cues[1].end).toBe(10);
    expect(cues[1].end - cues[1].start).toBeGreaterThan(cues[0].end - cues[0].start);
  });

  it('uses paragraphs as cues when there are blank lines', () => {
    const cues = spreadText('one\ntwo\n\nthree', 6);
    expect(cues.map((c) => c.text)).toEqual(['one\ntwo', 'three']);
  });

  it('returns nothing for empty text or no duration', () => {
    expect(spreadText('  \n ', 10)).toEqual([]);
    expect(spreadText('hi', 0)).toEqual([]);
  });

  it('detects timing lines', () => {
    expect(hasTimings(SRT)).toBe(true);
    expect(hasTimings('a --> b')).toBe(false);
    expect(hasTimings('plain words')).toBe(false);
  });
});

describe('captionAt', () => {
  const cues = [
    { start: 1, end: 3, text: 'first' },
    { start: 2, end: 4, text: 'second' },
  ];

  it('is inclusive at the start and exclusive at the end', () => {
    expect(captionAt(cues, 0.99)).toBe('');
    expect(captionAt(cues, 1)).toBe('first');
    expect(captionAt(cues, 3)).toBe('second');
    expect(captionAt(cues, 4)).toBe('');
  });

  it('stacks overlapping cues', () => {
    expect(captionAt(cues, 2.5)).toBe('first\nsecond');
  });
});

describe('decodeText', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);

  it('reads UTF-8 (with or without a BOM)', () => {
    expect(decodeText(new TextEncoder().encode('café'))).toBe('café');
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x68, 0x69))).toBe('hi');
  });

  it('reads UTF-16 with a BOM', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x68, 0, 0x69, 0))).toBe('hi');
    expect(decodeText(bytes(0xfe, 0xff, 0, 0x68, 0, 0x69))).toBe('hi');
  });

  it('falls back to Windows-1252 for legacy files', () => {
    expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9))).toBe('café');
  });
});

// every character is half the font size wide
const measure = (s: string, px: number) => s.length * px * 0.5;

describe('wrapLines', () => {
  const m = (s: string) => s.length;

  it('wraps greedily at spaces and keeps manual breaks', () => {
    expect(wrapLines('one two three four', 9, m)).toEqual(['one two', 'three', 'four']);
    expect(wrapLines('a\nb c', 10, m)).toEqual(['a', 'b c']);
  });

  it('breaks words (and unspaced scripts) that are wider than a line', () => {
    expect(wrapLines('abcdefghij', 4, m)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapLines('hi abcdefgh', 4, m)).toEqual(['hi', 'abcd', 'efgh']);
  });

  it('returns nothing for blank text', () => {
    expect(wrapLines('  \n ', 10, m)).toEqual([]);
  });
});

describe('layoutCaption', () => {
  const style = (over: Partial<CaptionStyle> = {}): CaptionStyle => ({ ...defaultStyle, outline: 0, ...over });

  it('sizes text from the frame height and sits above the bottom edge', () => {
    const l = layoutCaption('hello', style({ size: 0.05 }), 1920, 1000, measure)!;
    expect(l.px).toBe(50);
    expect(l.lineHeight).toBe(Math.round(50 * LINE_HEIGHT));
    const line = l.lines[0];
    expect(line.x).toBe(960);
    expect(line.y + l.lineHeight / 2).toBeCloseTo(1000 - 1000 * EDGE);
    expect(line.width).toBe(125);
  });

  it('places captions at the top or in the middle', () => {
    const top = layoutCaption('hi', style({ size: 0.05, position: 'top' }), 1000, 1000, measure)!;
    expect(top.lines[0].y - top.lineHeight / 2).toBeCloseTo(1000 * EDGE);
    const mid = layoutCaption('hi', style({ size: 0.05, position: 'middle' }), 1000, 1000, measure)!;
    expect(mid.lines[0].y).toBeCloseTo(500);
  });

  it('wraps to the max width and applies uppercase', () => {
    // 50px font → 25px per character; 40% of 1000px = 400px = 16 characters
    const l = layoutCaption('the quick brown fox jumps', style({ size: 0.05, maxWidth: 0.4, uppercase: true }), 1000, 1000, measure)!;
    expect(l.lines.map((x) => x.text)).toEqual(['THE QUICK BROWN', 'FOX JUMPS']);
  });

  it('leaves room for the box padding and outline', () => {
    const l = layoutCaption('x', style({ size: 0.05, box: true, outline: 0.1 }), 1000, 1000, measure)!;
    expect(l.padX).toBe(20);
    expect(l.outline).toBe(5);
  });

  it('returns null for blank text', () => {
    expect(layoutCaption('   ', style(), 1000, 1000, measure)).toBeNull();
  });
});

describe('drawCaption', () => {
  function fakeCtx() {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, key: string) => (key === 'roundRect' || typeof key !== 'string' ? undefined : (...args: unknown[]) => calls.push(`${key}(${args.join(',')})`)),
        set: (_t, key: string, value) => (calls.push(`${key}=${value}`), true),
      },
    );
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  it('draws box, then outline, then fill, in one background path', () => {
    const s: CaptionStyle = { ...defaultStyle, box: true, outline: 0.1, color: '#fff000' };
    const l = layoutCaption('two\nlines', s, 1000, 1000, measure)!;
    const { ctx, calls } = fakeCtx();
    drawCaption(ctx, l, s);
    const order = calls.filter((c) => /^(fill|rect|strokeText|fillText|beginPath)\(/.test(c)).map((c) => c.split('(')[0]);
    expect(order).toEqual(['beginPath', 'rect', 'rect', 'fill', 'strokeText', 'strokeText', 'fillText', 'fillText']);
    expect(calls).toContain('fillStyle=#fff000');
  });

  it('skips the outline and box when they are off', () => {
    const s: CaptionStyle = { ...defaultStyle, box: false, outline: 0 };
    const { ctx, calls } = fakeCtx();
    drawCaption(ctx, layoutCaption('hi', s, 100, 100, measure)!, s);
    expect(calls.some((c) => c.startsWith('strokeText') || c.startsWith('rect'))).toBe(false);
    expect(calls.filter((c) => c.startsWith('fillText'))).toHaveLength(1);
  });
});

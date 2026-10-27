import { describe, expect, it } from 'vitest';
import { checkLimits, graphemes, smsInfo, xLength } from '@/tools/lib/character-counter/limits';

describe('graphemes', () => {
  it('counts what you see, not code units', () => {
    expect(graphemes('')).toBe(0);
    expect(graphemes('hello world')).toBe(11);
    expect(graphemes('👍🏽')).toBe(1);
    expect(graphemes('👨‍👩‍👧')).toBe(1);
    expect(graphemes('🇺🇸')).toBe(1);
    expect(graphemes('é')).toBe(1);
  });
});

describe('xLength', () => {
  it('weights Latin as 1 and CJK as 2', () => {
    expect(xLength('hello')).toBe(5);
    expect(xLength('a'.repeat(280))).toBe(280);
    expect(xLength('日本語')).toBe(6);
    expect(xLength('“quote” — ok')).toBe(12);
  });

  it('counts any emoji as 2, however many code points it has', () => {
    expect(xLength('😀')).toBe(2);
    expect(xLength('👨‍👩‍👧')).toBe(2);
    expect(xLength('🇺🇸')).toBe(2);
    expect(xLength('hi 👍🏽')).toBe(5);
  });

  it('normalizes to NFC first', () => {
    expect(xLength('café')).toBe(4);
  });

  it('counts links as 23, leaving closing punctuation outside', () => {
    expect(xLength('see https://example.com/a/very/long/path/that/goes/on.')).toBe(4 + 23 + 1);
    expect(xLength('www.roundertools.com')).toBe(23);
    expect(xLength('roundertools.com/character-counter rocks')).toBe(23 + 6);
    expect(xLength('e.g. this')).toBe(9);
  });
});

describe('smsInfo', () => {
  it('fits 160 GSM-7 characters in one text and 153 per part after that', () => {
    expect(smsInfo('')).toMatchObject({ encoding: 'GSM-7', units: 0, segments: 0 });
    expect(smsInfo('a'.repeat(160))).toMatchObject({ encoding: 'GSM-7', segments: 1, single: 160 });
    expect(smsInfo('a'.repeat(161)).segments).toBe(2);
    expect(smsInfo('a'.repeat(306)).segments).toBe(2);
    expect(smsInfo('a'.repeat(307)).segments).toBe(3);
  });

  it('counts the extension table as 2', () => {
    expect(smsInfo('€').units).toBe(2);
    expect(smsInfo('[x]').units).toBe(5);
    expect(smsInfo('Ünïcode? no: ü and é are GSM').encoding).toBe('UCS-2');
    expect(smsInfo('ü and é are GSM').encoding).toBe('GSM-7');
  });

  it('switches to UCS-2 and names the character that caused it', () => {
    expect(smsInfo('hi 😀')).toMatchObject({ encoding: 'UCS-2', units: 5, segments: 1, single: 70, culprit: '😀' });
    expect(smsInfo('ça va').culprit).toBe('ç');
    expect(smsInfo('it’s').culprit).toBe('’');
    expect(smsInfo('é'.repeat(10) + '’' + 'a'.repeat(60)).segments).toBe(2);
    expect(smsInfo('’'.repeat(134)).segments).toBe(2);
    expect(smsInfo('’'.repeat(135)).segments).toBe(3);
  });
});

describe('checkLimits', () => {
  it('reports each platform in the order asked', () => {
    const text = 'x'.repeat(150);
    const [youtube, meta, x] = checkLimits(text, ['youtube', 'meta', 'x']);
    expect(youtube).toMatchObject({ used: 150, max: 100, state: 'over', soft: false, status: '50 over' });
    expect(meta).toMatchObject({ used: 150, max: 160, state: 'near', soft: true, status: '10 left' });
    expect(x).toMatchObject({ used: 150, max: 280, state: 'ok', status: '130 left' });
    expect(checkLimits('x'.repeat(2300), ['meta', 'instagram']).map((m) => m.status)).toEqual(['2,140 over, may be cut off', '100 over']);
  });

  it('measures the SMS meter against one text and says how a longer one is split', () => {
    expect(checkLimits('hello', ['sms'])[0]).toMatchObject({ used: 5, max: 160, status: '155 left', detail: 'GSM-7' });
    const [sms] = checkLimits('😀'.repeat(40), ['sms']);
    expect(sms).toMatchObject({ used: 80, max: 70, state: 'over', status: 'sent as 2 texts of up to 67', detail: 'UCS-2 because of “😀”' });
  });

  it('names an invisible culprit by its code, and keeps an emoji whole deep into a long text', () => {
    expect(checkLimits('hello there', ['sms'])[0].detail).toBe('UCS-2 because of the invisible character U+00A0');
    expect(checkLimits('café', ['sms'])[0].detail).toBe('UCS-2 because of the accent mark U+0301');
    expect(smsInfo('a'.repeat(5000) + '👍🏽 ok').culprit).toBe('👍🏽');
  });
});

describe('xLength links', () => {
  it("doesn't treat an email address, a handle or a cashtag as a link", () => {
    expect(xLength('name@gmail.com')).toBe(14);
    expect(xLength('mail me: a.b@example.org')).toBe(24);
    expect(xLength('#site.com')).toBe(9);
    expect(xLength('(see example.com)')).toBe(1 + 4 + 23 + 1);
  });
});

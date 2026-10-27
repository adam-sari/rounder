import { describe, expect, it } from 'vitest';
import { brandAsM4a, guessPlatform, limitSelection, loudestWindow, MAX_SEC, windowAt } from '@/tools/lib/ringtone-maker/ringtone';
import tool from '@/tools/defs/ringtone-maker';

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

/** the ftyp box mediabunny writes for audio-only MP4 */
function mediabunnyFtyp(): Uint8Array {
  const b = new Uint8Array(32);
  const v = new DataView(b.buffer);
  v.setUint32(0, 24);
  [...'ftypisom'].forEach((c, i) => (b[4 + i] = c.charCodeAt(0)));
  v.setUint32(12, 0x200);
  [...'isommp41'].forEach((c, i) => (b[16 + i] = c.charCodeAt(0)));
  v.setUint32(24, 8);
  [...'free'].forEach((c, i) => (b[28 + i] = c.charCodeAt(0)));
  return b;
}

describe('limitSelection', () => {
  it('leaves short selections alone', () => {
    expect(limitSelection(5, 30, { start: 5, end: 30 })).toEqual({ start: 5, end: 30 });
  });
  it('stops the dragged start handle at 40 s', () => {
    expect(limitSelection(0, 50, { start: 10, end: 50 })).toEqual({ start: 10, end: 50 });
  });
  it('stops the dragged end handle at 40 s', () => {
    expect(limitSelection(10, 70, { start: 10, end: 45 })).toEqual({ start: 10, end: 10 + MAX_SEC });
  });
  it('lets the end follow when both moved', () => {
    expect(limitSelection(0, 100, { start: 3, end: 4 })).toEqual({ start: 0, end: 40 });
  });
});

describe('windowAt', () => {
  it('slides back from the end of the song', () => {
    expect(windowAt(170, 30, 180)).toEqual({ start: 150, end: 180 });
  });
  it('shrinks to fit a short clip', () => {
    expect(windowAt(3, 30, 12)).toEqual({ start: 0, end: 12 });
  });
});

describe('loudestWindow', () => {
  it('finds the loud stretch', () => {
    // 100 s song, 1 bucket per second, loud from 60 to 90 s
    const rms = Float32Array.from({ length: 100 }, (_, i) => (i >= 60 && i < 90 ? 0.8 : 0.1));
    expect(loudestWindow(rms, 100, 30)).toBe(60);
  });
  it('starts at 0 when the song is shorter than the window', () => {
    expect(loudestWindow(new Float32Array(10).fill(1), 20, 30)).toBe(0);
  });
  it('never runs past the end', () => {
    const rms = Float32Array.from({ length: 50 }, (_, i) => (i > 45 ? 1 : 0));
    expect(loudestWindow(rms, 50, 30)).toBeLessThanOrEqual(20);
  });
});

describe('brandAsM4a', () => {
  it('rewrites the brands in place, keeping isom compatible', () => {
    const out = brandAsM4a(mediabunnyFtyp());
    expect(ascii(out, 8)).toBe('M4A ');
    expect(ascii(out, 16)).toBe('M4A ');
    expect(ascii(out, 20)).toBe('isom');
    expect(new DataView(out.buffer).getUint32(0)).toBe(24);
    expect(ascii(out, 28)).toBe('free');
  });
  it('leaves anything that is not an MPEG-4 file alone', () => {
    const wav = new TextEncoder().encode('RIFF....WAVEfmt ');
    expect(brandAsM4a(wav)).toBe(wav);
  });
});

describe('guessPlatform', () => {
  it('picks Android only on Android', () => {
    expect(guessPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    expect(guessPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iphone');
  });
});

describe('page copy', () => {
  it('fits search limits', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.keywords.length).toBeLessThanOrEqual(10);
  });
});

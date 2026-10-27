import { describe, expect, it } from 'vitest';
import { finish, imgTag, shorten, tidy, toCsv } from '../../src/tools/lib/alt-text-generator/text';

describe('tidy', () => {
  it('drops filler lead-ins and capitalises', () => {
    expect(tidy('In this image we can see a dog on the bed', 'detailed')).toBe('A dog on the bed.');
    expect(tidy('The image shows a red car parked on a street.', 'long')).toBe('A red car parked on a street.');
    expect(tidy('an image of a cat', 'alt')).toBe('A cat.');
    expect(tidy('A photo of two people hiking.', 'alt')).toBe('Two people hiking.');
  });

  it('keeps captions that only mention a picture later on', () => {
    expect(tidy('A man holding a picture of his family.', 'alt')).toBe('A man holding a picture of his family.');
  });

  it('removes repeated sentences and stray tokens', () => {
    expect(tidy('</s><s>A dog runs.  A dog runs. It is sunny.</s>', 'long')).toBe('A dog runs. It is sunny.');
  });

  it('does not split decimals', () => {
    expect(tidy('A 3.5 inch screen. A phone.', 'detailed')).toBe('A 3.5 inch screen. A phone.');
  });

  it('leaves OCR text as read, apart from whitespace', () => {
    expect(tidy('  SALE   50% off  ', 'ocr')).toBe('SALE 50% off');
  });
});

describe('shorten', () => {
  it('keeps whole sentences within the limit', () => {
    const text = `${'a'.repeat(60)}. ${'b'.repeat(50)}. ${'c'.repeat(30)}.`;
    expect(shorten(text)).toBe(`${'a'.repeat(60)}. ${'b'.repeat(50)}.`);
  });

  it('never cuts a single long sentence', () => {
    const long = `${'word '.repeat(40).trim()}.`;
    expect(shorten(long)).toBe(long);
  });

  it('only trims alt text', () => {
    const text = `${'a'.repeat(100)}. ${'b'.repeat(100)}.`;
    expect(finish(text, 'alt')).toBe(`${'A'}${'a'.repeat(99)}.`);
    expect(finish(text, 'detailed')).toHaveLength(text.length);
  });
});

describe('export', () => {
  it('writes RFC 4180 CSV with a BOM', () => {
    expect(toCsv(['filename', 'alt'], [['a.jpg', 'A "big", red\nball'], ['b.png', 'Plain']])).toBe('﻿filename,alt\r\na.jpg,"A ""big"", red\nball"\r\nb.png,Plain\r\n');
  });

  it('escapes an img tag', () => {
    expect(imgTag('cat & dog.jpg', 'A "cute" <cat>')).toBe('<img src="cat &amp; dog.jpg" alt="A &quot;cute&quot; &lt;cat&gt;">');
  });
});

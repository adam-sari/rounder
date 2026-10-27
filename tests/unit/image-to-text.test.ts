import { describe, expect, it } from 'vitest';
import tool from '../../src/tools/defs/image-to-text';
import { defaultLanguages, LANGUAGES, languageBytes, languageNames, languageUrl, normalizeLanguages, TESSDATA } from '../../src/tools/lib/ocr/languages';
import { joinLines, meanConfidence, ocrScale, pageText, pageWords, tidyCjk, toPgm } from '../../src/tools/lib/ocr/text';

const bbox = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const word = (text: string, confidence: number, box = bbox(0, 0, 10, 10)) => ({ text, confidence, bbox: box });
const line = (text: string, words = [word(text.trim(), 90)]) => ({ text, words });
// just the fields the helpers read
const page = (paragraphs: { lines: ReturnType<typeof line>[] }[], text = '') => ({ text, blocks: [{ paragraphs }] }) as never;

describe('languages', () => {
  it('pins tessdata_fast to a commit and builds jsDelivr URLs', () => {
    expect(TESSDATA.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(languageUrl('chi_sim')).toBe(`https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@${TESSDATA.revision}/chi_sim.traineddata`);
  });

  it('lists unique codes with real sizes', () => {
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(20);
    for (const l of LANGUAGES) expect(l.bytes).toBeGreaterThan(300_000);
    expect(languageBytes(['eng', 'deu'])).toBe(4113088 + 1525436);
    expect(languageNames(['eng', 'deu'])).toBe('English + German');
  });

  it('picks a default from the browser languages', () => {
    expect(defaultLanguages(['de-AT', 'en'])).toEqual(['deu']);
    expect(defaultLanguages(['zh-TW'])).toEqual(['chi_tra']);
    expect(defaultLanguages(['zh-Hant-HK'])).toEqual(['chi_tra']);
    expect(defaultLanguages(['zh-CN'])).toEqual(['chi_sim']);
    expect(defaultLanguages(['xx', 'pt-BR'])).toEqual(['por']);
    expect(defaultLanguages(['xx'])).toEqual(['eng']);
    expect(defaultLanguages([])).toEqual(['eng']);
  });

  it('normalizes saved picks', () => {
    expect(normalizeLanguages(['deu', 'nope', 'eng', 'deu'])).toEqual(['eng', 'deu']);
    expect(normalizeLanguages(['nope'])).toEqual(['eng']);
  });
});

describe('recognized text', () => {
  it('keeps lines and puts a blank line between paragraphs', () => {
    const p = page([{ lines: [line('Hello there\n'), line('second line\n')] }, { lines: [line('  New paragraph \n')] }]);
    expect(pageText(p)).toBe('Hello there\nsecond line\n\nNew paragraph');
  });

  it('falls back to the flat text without layout', () => {
    expect(pageText({ text: ' plain\ntext \n', blocks: null } as never)).toBe('plain\ntext');
  });

  it('drops the spaces Tesseract puts between Chinese and Japanese characters, not Korean ones', () => {
    expect(tidyCjk('这 是 一 个 测 试')).toBe('这是一个测试');
    expect(tidyCjk('日本 語 の テスト。')).toBe('日本語のテスト。');
    expect(tidyCjk('Hello 世 界 and more')).toBe('Hello 世界 and more');
    expect(tidyCjk('한국어 문장')).toBe('한국어 문장');
  });

  it('joins wrapped lines per paragraph and mends hyphenation', () => {
    expect(joinLines('A long sen-\ntence that\nwraps.\n\nNext one')).toBe('A long sentence that wraps.\n\nNext one');
    expect(joinLines('中文\n句子')).toBe('中文句子');
  });

  it('scales word boxes back to the original image', () => {
    const p = page([{ lines: [line('Hi you', [word('Hi', 91.6, bbox(20, 40, 60, 80)), word(' ', 0), word('you', 40, bbox(80, 40, 140, 80))])] }]);
    expect(pageWords(p, 2)).toEqual([
      { text: 'Hi', confidence: 92, x: 10, y: 20, w: 20, h: 20 },
      { text: 'you', confidence: 40, x: 40, y: 20, w: 30, h: 20 },
    ]);
    expect(meanConfidence(pageWords(p, 2))).toBe(66);
    expect(meanConfidence([])).toBeNull();
  });
});

describe('image preparation', () => {
  it('upscales small images and caps huge ones', () => {
    expect(ocrScale(800, 600)).toBe(3);
    expect(ocrScale(1920, 1080)).toBe(2);
    expect(ocrScale(4032, 3024)).toBe(1);
    const big = ocrScale(10000, 8000);
    expect(big).toBeLessThan(1);
    expect(10000 * 8000 * big * big).toBeCloseTo(16e6, -3);
  });

  it('writes binary PGM, flattening transparency onto white', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 255, 0, 0, 255]);
    const pgm = toPgm(rgba, 2, 2);
    const header = 'P5\n2 2\n255\n';
    expect(new TextDecoder().decode(pgm.slice(0, header.length))).toBe(header);
    expect([...pgm.slice(header.length)]).toEqual([0, 255, 255, 76]);
  });
});

describe('page copy', () => {
  it('fits search limits and credits the model', () => {
    expect(tool.title.length).toBeLessThanOrEqual(65);
    expect(tool.description.length).toBeLessThanOrEqual(160);
    expect(tool.keywords.length).toBeGreaterThanOrEqual(6);
    expect(tool.faq.some((f) => /Apache-2\.0/.test(f.a))).toBe(true);
  });
});

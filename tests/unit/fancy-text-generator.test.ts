import { describe, expect, it } from 'vitest';
import { combine, fullwidth, graphemes, mapChars, styles, tables, upsideDown, zalgo } from '@/tools/lib/fancy-text/styles';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const opts = { seed: 1, intensity: 3 };
const cp = (s: string) => s.codePointAt(0)!;

describe('math alphabets', () => {
  it('maps the anchors of each block correctly', () => {
    expect(mapChars('Az09', tables.bold)).toBe('𝐀𝐳𝟎𝟗');
    expect(mapChars('Az', tables.italic)).toBe('𝐴𝑧');
    expect(mapChars('Az', tables.boldItalic)).toBe('𝑨𝒛');
    expect(mapChars('Az09', tables.sans)).toBe('𝖠𝗓𝟢𝟫');
    expect(mapChars('Az09', tables.sansBold)).toBe('𝗔𝘇𝟬𝟵');
    expect(mapChars('Az', tables.sansItalic)).toBe('𝘈𝘻');
    expect(mapChars('Az', tables.sansBoldItalic)).toBe('𝘼𝙯');
    expect(mapChars('Az', tables.boldScript)).toBe('𝓐𝔃');
    expect(mapChars('Az', tables.boldFraktur)).toBe('𝕬𝖟');
    expect(mapChars('Az09', tables.monospace)).toBe('𝙰𝚣𝟶𝟿');
    expect(mapChars('Az09', tables.doubleStruck)).toBe('𝔸𝕫𝟘𝟡');
  });

  it('fills the reserved holes with the older letterlike symbols', () => {
    expect(mapChars('h', tables.italic)).toBe('ℎ');
    expect(mapChars('BEFHILMRego', tables.script)).toBe('ℬℰℱℋℐℒℳℛℯℊℴ');
    expect(mapChars('CHIRZ', tables.fraktur)).toBe('ℭℌℑℜℨ');
    expect(mapChars('CHNPQRZ', tables.doubleStruck)).toBe('ℂℍℕℙℚℝℤ');
  });

  it('never lands on an unassigned hole in the math block', () => {
    // code points the math block reserves because the letter already existed elsewhere
    const holes = [
      0x1d455, 0x1d49d, 0x1d4a0, 0x1d4a1, 0x1d4a3, 0x1d4a4, 0x1d4a7, 0x1d4a8, 0x1d4ad, 0x1d4ba, 0x1d4bc, 0x1d4c4,
      0x1d506, 0x1d50b, 0x1d50c, 0x1d515, 0x1d51d, 0x1d53a, 0x1d53f, 0x1d545, 0x1d547, 0x1d548, 0x1d549, 0x1d551,
    ];
    for (const t of Object.values(tables)) {
      for (const c of ALPHA) expect(holes).not.toContain(cp(t.get(c) ?? c));
    }
  });

  it('maps every letter to a distinct character in the full alphabets', () => {
    for (const key of ['bold', 'italic', 'script', 'fraktur', 'doubleStruck', 'monospace', 'circled'] as const) {
      const out = [...mapChars(ALPHA, tables[key])];
      expect(new Set(out).size).toBe(52);
    }
  });

  it('leaves characters it has no mapping for alone', () => {
    expect(mapChars('Hi, 👋 é!', tables.bold)).toBe('𝐇𝐢, 👋 é!');
  });
});

describe('shapes', () => {
  it('maps bubbles, squares and digits', () => {
    expect(mapChars('Ab0 19', tables.circled)).toBe('Ⓐⓑ⓪ ①⑨');
    expect(mapChars('Ab0', tables.circledBlack)).toBe('🅐🅑⓿');
    expect(mapChars('Ab', tables.squared)).toBe('🄰🄱');
    expect(mapChars('Zz', tables.squaredBlack)).toBe('🆉🆉');
    expect(mapChars('a1', tables.parenthesized)).toBe('⒜⑴');
  });

  it('makes text fullwidth, including spaces', () => {
    expect(fullwidth('Hi 5!')).toBe('Ｈｉ　５！');
    expect(fullwidth('é')).toBe('é');
  });
});

describe('small caps and superscript', () => {
  it('keeps capitals and shrinks lower case', () => {
    expect(mapChars('Hello', tables.smallCaps)).toBe('Hᴇʟʟᴏ');
  });

  it('superscripts letters, digits and signs', () => {
    expect(mapChars('x2+1', tables.superscript)).toBe('ˣ²⁺¹');
    expect(mapChars('Hi', tables.superscript)).toBe('ᴴⁱ');
    expect(mapChars('Cx', tables.superscript)).toBe('ᶜˣ');
  });
});

describe('effects', () => {
  it('flips and reverses text', () => {
    expect(upsideDown('hello')).toBe('ollǝɥ');
    expect(upsideDown('Hi!')).toBe('¡ᴉH');
    expect(upsideDown('(6)')).toBe('(9)');
  });

  it('adds a combining mark after each character but not line breaks', () => {
    expect(combine('ab\nc', '̶')).toBe('a̶b̶\nc̶');
  });

  it('zalgo is deterministic for a seed and keeps the base letters', () => {
    const a = zalgo('glitch me', 7, 5);
    expect(zalgo('glitch me', 7, 5)).toBe(a);
    expect(zalgo('glitch me', 8, 5)).not.toBe(a);
    expect(a.replace(/[̀-ͯ]/g, '')).toBe('glitch me');
  });

  it('zalgo gets noisier with intensity', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    expect(zalgo(text, 3, 10).length).toBeGreaterThan(zalgo(text, 3, 1).length);
  });
});

describe('style list', () => {
  it('has at least 25 styles with unique ids', () => {
    expect(styles.length).toBeGreaterThanOrEqual(25);
    expect(new Set(styles.map((s) => s.id)).size).toBe(styles.length);
  });

  it('every style changes plain text and keeps empty input empty', () => {
    for (const s of styles) {
      expect(s.apply('Hello', opts), s.id).not.toBe('Hello');
      expect(s.apply('', opts), s.id).toBe('');
    }
  });
});

describe('emoji and accents', () => {
  it('keeps flags, skin tones and decomposed accents whole', () => {
    expect(graphemes('a👍🏽🇺🇸é\r\n')).toEqual(['a', '👍🏽', '🇺🇸', 'é', '\r\n']);
    expect(graphemes('ab\r\nc')).toEqual(['a', 'b', '\r\n', 'c']);
  });

  it('flips text without scrambling emoji', () => {
    expect(upsideDown('hi 🇺🇸👍🏽')).toBe('👍🏽🇺🇸 ᴉɥ');
  });

  it('marks and spaces whole emoji, not their parts', () => {
    expect(combine('👍🏽\r\n', '̶')).toBe('👍🏽̶\r\n');
    expect(styles.find((s) => s.id === 'spaced')!.apply('a🇺🇸\r\nb', opts)).toBe('a 🇺🇸\r\nb');
    expect(zalgo('🇺🇸', 1, 10).startsWith('🇺🇸')).toBe(true);
  });
});

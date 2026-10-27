import { describe, expect, it } from 'vitest';
import { buildIco } from '@/tools/lib/favicon/ico';
import { firstGraphemes, linkTags, nestSvg, textSvg, webManifest } from '@/tools/lib/favicon/markup';

const fakePng = (n: number, fill: number) => new Uint8Array(n).fill(fill);

describe('buildIco', () => {
  const ico = buildIco([
    { size: 16, png: fakePng(10, 1) },
    { size: 32, png: fakePng(20, 2) },
    { size: 256, png: fakePng(5, 3) },
  ]);
  const view = new DataView(ico.buffer);

  it('writes the header', () => {
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(3);
  });

  it('writes one directory entry per image, with 256 stored as 0', () => {
    expect([ico[6], ico[7], ico[22], ico[38], ico[39]]).toEqual([16, 16, 32, 0, 0]);
    expect(view.getUint16(6 + 4, true)).toBe(1);
    expect(view.getUint16(6 + 6, true)).toBe(32);
  });

  it('points each entry at its png bytes', () => {
    expect(ico.length).toBe(6 + 16 * 3 + 35);
    const sizes = [10, 20, 5];
    let expected = 6 + 16 * 3;
    for (let i = 0; i < 3; i++) {
      const at = 6 + 16 * i;
      expect(view.getUint32(at + 8, true)).toBe(sizes[i]);
      expect(view.getUint32(at + 12, true)).toBe(expected);
      expect(ico[expected]).toBe(i + 1);
      expected += sizes[i];
    }
  });

  it('rejects sizes an icon cannot hold', () => {
    expect(() => buildIco([{ size: 512, png: fakePng(1, 0) }])).toThrow(RangeError);
  });
});

describe('firstGraphemes', () => {
  it('counts emoji sequences as one character', () => {
    expect(firstGraphemes('👨‍👩‍👧‍👦🇬🇧x', 2)).toBe('👨‍👩‍👧‍👦🇬🇧');
    expect(firstGraphemes('Hello', 2)).toBe('He');
    expect(firstGraphemes('', 2)).toBe('');
  });
});

describe('svg output', () => {
  it('escapes text and clips non-square shapes', () => {
    const svg = textSvg({ text: '<&', fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, color: '#000', fontSize: 80, x: 10, y: 70, shape: 'circle', background: '#fff' });
    expect(svg).toContain('&#60;&#38;</text>');
    expect(svg).toContain('&#34;Times New Roman&#34;');
    expect(svg).toContain('rx="50"');
    expect(svg).toContain('clip-path="url(#favicon-shape)"');
  });

  it('nests an svg in the padded box, keeping its viewBox', () => {
    const src = '<?xml version="1.0"?>\n<!-- logo --><svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg>';
    const out = nestSvg(src, { padding: 10, fit: 'fit', shape: 'square', fallbackWidth: 1, fallbackHeight: 1 });
    expect(out).not.toContain('<?xml');
    expect(out).not.toContain('clipPath');
    expect(out).toContain('<svg x="10" y="10" width="80" height="80" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">');
    expect(out).toContain('<path d="M0 0h24v24z"/>');
  });

  it('adds a viewBox from the size when the source has none', () => {
    const out = nestSvg('<svg width="40" height="20"><rect/></svg>', { padding: 0, fit: 'fill', shape: 'rounded', fallbackWidth: 1, fallbackHeight: 1 });
    expect(out).toContain('viewBox="0 0 40 20" preserveAspectRatio="xMidYMid slice"');
  });

  it('drops a DOCTYPE, and refuses one that declares entities', () => {
    const opts = { padding: 0, fit: 'fit', shape: 'square', fallbackWidth: 1, fallbackHeight: 1 } as const;
    const out = nestSvg('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg viewBox="0 0 1 1"/>', opts);
    expect(out).not.toContain('DOCTYPE');
    expect(() => nestSvg('<!DOCTYPE svg [<!ENTITY ns "http://x">]><svg xmlns:x="&ns;" viewBox="0 0 1 1"/>', opts)).toThrow();
  });

  it('rejects files that are not svg', () => {
    expect(() => nestSvg('<html></html>', { padding: 0, fit: 'fit', shape: 'square', fallbackWidth: 1, fallbackHeight: 1 })).toThrow();
  });
});

describe('manifest and tags', () => {
  it('lists the android icons', () => {
    const m = JSON.parse(webManifest('Shop', '#ffd25e'));
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
    expect(m.theme_color).toBe('#ffd25e');
  });

  it('only links the svg when there is one', () => {
    expect(linkTags(true)).toContain('favicon.svg');
    expect(linkTags(false)).not.toContain('favicon.svg');
  });
});

import { describe, expect, it } from 'vitest';
import { FALLBACK_SIZE, hasExternalRefs, parseLength, prepareSvg, readSvgSize, targetSize } from '@/tools/lib/svg-to-png/svg';

describe('parseLength', () => {
  it('converts units to px', () => {
    expect(parseLength('100')).toBe(100);
    expect(parseLength('24px')).toBe(24);
    expect(parseLength('1in')).toBe(96);
    expect(parseLength('72pt')).toBe(96);
  });
  it('ignores percentages and junk', () => {
    expect(parseLength('100%')).toBeUndefined();
    expect(parseLength('auto')).toBeUndefined();
    expect(parseLength(undefined)).toBeUndefined();
  });
});

describe('readSvgSize', () => {
  it('uses width and height', () => {
    expect(readSvgSize('<svg width="200" height="100" viewBox="0 0 20 10"></svg>')).toEqual({ width: 200, height: 100, guessed: false });
  });
  it('falls back to the viewBox', () => {
    expect(readSvgSize('<svg viewBox="0 0 24 24"><path d=""/></svg>')).toEqual({ width: 24, height: 24, guessed: false });
    expect(readSvgSize('<svg width="100%" height="100%" viewBox="0,0,48,24"></svg>')).toEqual({ width: 48, height: 24, guessed: false });
  });
  it('derives a missing side from the viewBox ratio', () => {
    expect(readSvgSize('<svg width="300" viewBox="0 0 30 10"></svg>')).toEqual({ width: 300, height: 100, guessed: false });
  });
  it('guesses when there is no size at all', () => {
    expect(readSvgSize('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')).toEqual({ width: FALLBACK_SIZE, height: FALLBACK_SIZE, guessed: true });
  });
  it('rejects non-svg text', () => {
    expect(() => readSvgSize('<html></html>')).toThrow();
  });
});

describe('targetSize', () => {
  it('scales and keeps the aspect ratio', () => {
    expect(targetSize({ width: 24, height: 12 }, { mode: 'scale', factor: 4 })).toEqual({ width: 96, height: 48, capped: false });
    expect(targetSize({ width: 300, height: 100 }, { mode: 'width', px: 1200 })).toEqual({ width: 1200, height: 400, capped: false });
    expect(targetSize({ width: 300, height: 100 }, { mode: 'height', px: 50 })).toEqual({ width: 150, height: 50, capped: false });
  });
  it('caps huge outputs', () => {
    const out = targetSize({ width: 10000, height: 10000 }, { mode: 'scale', factor: 4 });
    expect(out.capped).toBe(true);
    expect(out.width * out.height).toBeLessThanOrEqual(40_000_000);
  });
});

describe('prepareSvg', () => {
  it('sets the size, keeps the viewBox and adds the namespace', () => {
    const out = prepareSvg('<svg viewBox="0 0 24 24" width="24" height="24"><path d="M0 0"/></svg>', 96, 96);
    expect(out).toBe('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="96" height="96"><path d="M0 0"/></svg>');
  });
  it('adds a viewBox so the content scales', () => {
    const out = prepareSvg('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="20"><use xlink:href="#a"/></svg>', 100, 40);
    expect(out).toContain('viewBox="0 0 50 20"');
    expect(out).toContain('xmlns:xlink=');
    expect(out).toContain('width="100" height="40"');
  });
  it('handles a ">" inside an attribute value', () => {
    const out = prepareSvg('<svg data-x="a>b" viewBox="0 0 1 1"></svg>', 10, 10);
    expect(out.startsWith('<svg data-x="a>b" viewBox="0 0 1 1"')).toBe(true);
  });
});

describe('hasExternalRefs', () => {
  it('spots linked images, fonts and stylesheets', () => {
    expect(hasExternalRefs('<image href="https://example.com/a.png"/>')).toBe(true);
    expect(hasExternalRefs('<image xlink:href="photo.jpg"/>')).toBe(true);
    expect(hasExternalRefs('<style>@import url(https://fonts.googleapis.com/css2?family=Inter);</style>')).toBe(true);
  });
  it('ignores embedded data and internal links', () => {
    expect(hasExternalRefs('<image href="data:image/png;base64,AAA"/><use href="#icon"/>')).toBe(false);
    expect(hasExternalRefs('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(false);
    expect(hasExternalRefs('<rect fill="url(#grad)"/><a href="https://example.com"><text>hi</text></a>')).toBe(false);
  });
  it('spots linked symbols and relative font files', () => {
    expect(hasExternalRefs('<use href="icons.svg#star"/>')).toBe(true);
    expect(hasExternalRefs('<style>@font-face{src:url(fonts/inter.woff2)}</style>')).toBe(true);
  });
});

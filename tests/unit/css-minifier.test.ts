import { describe, expect, it } from 'vitest';
import { minifyCss, safeMinifyCss } from '../../src/tools/lib/code-minifier/css';

const opts = { restructure: true, keepLicense: true };

describe('minifyCss', () => {
  it('minifies valid CSS with CSSO and keeps license comments', () => {
    const { code, notes } = minifyCss('/*! MIT */\n/* drop */\na { color: #ff0000; margin: 0px 0px; }\nb { color: #ff0000; margin: 0px 0px }', opts);
    expect(notes).toEqual([]);
    expect(code).toBe('/*! MIT */\na,b{color:red;margin:0}');
  });

  it('drops license comments when asked', () => {
    expect(minifyCss('/*! MIT */ a{color:red}', { ...opts, keepLicense: false }).code).toBe('a{color:red}');
  });

  it('does not restructure when turned off', () => {
    expect(minifyCss('a{color:red}b{color:red}', { ...opts, restructure: false }).code).toBe('a{color:red}b{color:red}');
  });

  it('falls back to safe minifying instead of dropping CSS it cannot parse', () => {
    const src = '.card {\n  color: red;\n  & .title { font-weight: 600; }\n}';
    const { code, notes } = minifyCss(src, opts);
    expect(code).toBe('.card{color:red;& .title{font-weight:600}}');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ line: 3, column: 4 });
    expect(notes[0].message).toMatch(/only comments and whitespace/);
  });

  it('keeps media range queries intact', () => {
    expect(minifyCss('@media (width >= 600px) { a { color: red } }', opts).code).toBe('@media (width>=600px){a{color:red}}');
  });

  it('minifies a style attribute body', () => {
    expect(minifyCss(' color : #ffffff ; margin: 0px ', opts, 'declarationList').code).toBe('color:#fff;margin:0');
  });
});

describe('safeMinifyCss', () => {
  it('keeps the space of a descendant pseudo-class selector', () => {
    // without parsing, a space before ":" can't be told apart from a selector's, so it stays
    expect(safeMinifyCss('a :hover , b > c { color: red ; }', true)).toBe('a :hover,b>c{color:red}');
  });

  it('keeps media query spacing that matters', () => {
    expect(safeMinifyCss('@media screen and ( min-width: 1px ) { }', true)).toBe('@media screen and (min-width:1px){}');
  });

  it('leaves strings, escapes and unquoted urls alone', () => {
    expect(safeMinifyCss('a::after { content: "  {;}  " ; background: url( a b.png ) }', true)).toBe('a::after{content:"  {;}  ";background:url( a b.png )}');
    expect(safeMinifyCss('.a\\: b { x: y }', true)).toBe('.a\\: b{x:y}');
  });

  it('treats a removed comment as a token separator', () => {
    expect(safeMinifyCss('a/* x */b{margin:1px/**/2px}', false)).toBe('a b{margin:1px 2px}');
    expect(safeMinifyCss('/*! keep */ a{}', true)).toBe('/*! keep */ a{}');
  });

  it('keeps calc spacing and empty custom properties', () => {
    expect(safeMinifyCss('a { width: calc( 100% - 2px ); --x: ; }', true)).toBe('a{width:calc(100% - 2px);--x:;}');
  });
});

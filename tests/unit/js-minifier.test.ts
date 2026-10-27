import { describe, expect, it } from 'vitest';
import { minifyJs } from '../../src/tools/lib/code-minifier/js';
import { defaultOptions, MinifyError } from '../../src/tools/lib/code-minifier/options';

describe('minifyJs', () => {
  it('compresses, mangles and keeps license comments', async () => {
    const { code } = await minifyJs('/*! MIT */\n// note\nfunction add(first, second) { return first + second }\nconsole.log(add(1, 2))', defaultOptions);
    expect(code).toBe('/*! MIT */\nfunction add(d,n){return d+n}console.log(add(1,2));');
  });

  it('can skip mangling and comments', async () => {
    const { code } = await minifyJs('/*! MIT */ function add(first, second) { return first + second } add(1, 2)', {
      ...defaultOptions, mangle: false, keepLicense: false,
    });
    expect(code).toBe('function add(first,second){return first+second}add(1,2);');
  });

  it('shortens top-level names in ES modules', async () => {
    const { code } = await minifyJs('const message = "hi"; export function greet() { return message }', { ...defaultOptions, module: true });
    expect(code).not.toContain('message');
  });

  it('reports syntax errors with a 1-based line and column', async () => {
    const error = await minifyJs('const a = 1;\nconst b = ;', defaultOptions).catch((e) => e);
    expect(error).toBeInstanceOf(MinifyError);
    expect(error).toMatchObject({ line: 2, column: 11 });
    expect(error.message).toMatch(/Unexpected token/);
  });

  it('suggests ES module mode for top-level await', async () => {
    const error = await minifyJs('const r = await fetch("/a");\nconsole.log(r)', defaultOptions).catch((e) => e);
    expect(error.message).toMatch(/Try turning on "ES module"/);
    expect((await minifyJs('const r = await fetch("/a");', { ...defaultOptions, module: true })).code).toContain('await');
  });
});

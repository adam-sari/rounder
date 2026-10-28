import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'rolldown';
import { afterAll, describe, expect, it } from 'vitest';
import { platformSwap, scanDist, SITE_SRC, viteGlob, viteQueryGuard } from '../src/index.mjs';

const tmp = mkdtempSync(join(import.meta.dirname, 'tmp-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** bundles a one-line entry that imports from the site, with the given plugins */
async function bundle(code: string, plugins: unknown[]) {
  const entry = join(tmp, `entry-${++n}.ts`);
  writeFileSync(entry, code);
  const file = join(tmp, `out-${n}.mjs`);
  await build({ input: entry, platform: 'node', resolve: { alias: { '@': SITE_SRC } }, external: (id) => /^[a-z@][^:]/i.test(id) && !id.startsWith('@/') && !/[?]|\.svelte/.test(id), plugins: plugins as never, logLevel: 'silent', output: { file, format: 'esm' } });
  return readFileSync(file, 'utf8');
}

describe('platformSwap', () => {
  it('swaps a leaf whether it is imported through the alias or a relative path', async () => {
    const twin = join(tmp, 'twin.ts');
    writeFileSync(twin, "export const loadPdfFontBytes = () => 'TWIN', runQpdf = loadPdfFontBytes, importPdfjs = loadPdfFontBytes, pdfjsAsset = loadPdfFontBytes, newCanvas = loadPdfFontBytes, documentOptions = {};");
    const out = await bundle("import { loadPdfFontBytes } from '@/engines/pdf/fonts'; export { loadPdfFontBytes };", [platformSwap({ 'engines/pdf/fonts': twin })]);
    expect(out).toContain('TWIN');
    // lib.ts imports './fonts' relatively
    const viaLib = await bundle("export { embedFontWithFallback } from '@/engines/pdf/lib';", [platformSwap({ 'engines/pdf/fonts': twin, 'engines/pdf/qpdf': twin, 'engines/pdf/pdfjs-env': twin })]);
    expect(viaLib).toContain('TWIN');
    expect(viaLib).not.toContain('import.meta.env');
  });

  it('fails a strict build when a swap goes unused, so a moved leaf is noticed', async () => {
    const twin = join(tmp, 'twin2.ts');
    writeFileSync(twin, 'export const x = 1;');
    await expect(bundle("export { parsePageRanges } from '@/engines/pdf/ranges';", [platformSwap({ 'engines/pdf/fonts': twin }, { strict: true })])).rejects.toThrow(/went unused/);
  });
});

describe('viteQueryGuard', () => {
  it('rejects ?raw and ?url imports', async () => {
    await expect(bundle("export * from '@/engines/pdf/qpdf.worker';", [viteQueryGuard()])).rejects.toThrow(/Vite-only import/);
  });

  it('rejects .svelte files (UI code stays AGPL)', async () => {
    await expect(bundle("export { default } from '@/tools/lib/timers/Dial.svelte';", [viteQueryGuard()])).rejects.toThrow(/UI code/);
  });

  it('rejects import.meta.env in site code', async () => {
    await expect(bundle("export * from '@/engines/pdf/fonts';", [viteQueryGuard()])).rejects.toThrow(/import\.meta\.env/);
  });

  it('rejects Web Workers in site code', async () => {
    await expect(bundle("export * from '@/tools/lib/compress-pdf/runner';", [viteQueryGuard()])).rejects.toThrow(/a Web Worker/);
  });

  it('lets pure site modules through', async () => {
    const out = await bundle("export { parsePageRanges } from '@/engines/pdf/ranges';", [viteQueryGuard()]);
    expect(out).toContain('parsePageRangeGroups');
  });
});

describe('viteGlob', () => {
  it("evaluates the site registry with every def file, at build time", async () => {
    const out = await bundle("export { tools } from '@/tools/registry';", [viteGlob()]);
    expect(out).not.toContain('import.meta.glob');
    const mod = await import(`file://${join(tmp, `out-${n}.mjs`).replaceAll('\\', '/')}`);
    expect(mod.tools.length).toBeGreaterThan(150);
    expect(mod.tools.some((t: { slug: string }) => t.slug === 'compress-pdf')).toBe(true);
  });
});

describe('scanDist', () => {
  it('flags leftovers the guard exists for', () => {
    expect(scanDist([['a.mjs', 'import x from "./w.js?url";']])).toHaveLength(1);
    expect(scanDist([['a.mjs', 'const b = import.meta.env.BASE_URL;']])).toHaveLength(1);
    expect(scanDist([['a.mjs', 'import "mediabunny";']])).toHaveLength(1);
    expect(scanDist([['a.mjs', 'export const ok = 1;']])).toHaveLength(0);
  });
});

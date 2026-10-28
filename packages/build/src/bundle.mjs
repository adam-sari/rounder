import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'rolldown';
import { platformSwap, scanDist, SITE_SRC, viteGlob, viteQueryGuard } from './index.mjs';

const JSQUASH_SUBPATH = /^@jsquash\/[a-z]+\/[\w/]+$/;
const BARE = /^(?![./\\]|[a-zA-Z]:|@\/|\0|node:)/;
const pkgName = (id) => (id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]);

/** jSquash ships no exports map, so Node needs the ".js" on its subpath imports ("@jsquash/jpeg/encode") */
const jsquashExt = () => ({
  name: 'rounder:jsquash-ext',
  resolveId(source) {
    if (JSQUASH_SUBPATH.test(source) && !source.endsWith('.js')) return { id: `${source}.js`, external: true };
    return null;
  },
});

/**
 * Bundles a package's entries with the site's code pulled in through the `@/` alias. Bare imports stay external
 * (declared dependencies, installed next to the package) unless listed in `inline`.
 */
export async function bundlePackage({ input, outDir, inline = [], swaps = {}, strictSwaps = false, define = {}, banner, clean = true, siteAlias = true }) {
  if (clean) await rm(outDir, { recursive: true, force: true });
  const inlined = new Set(inline);
  const result = await build({
    input,
    platform: 'node',
    resolve: { alias: siteAlias ? { '@': SITE_SRC } : {} },
    // jsquashExt resolves (and externalizes) jSquash's subpaths itself, to add the .js
    // and Vite-only imports (?raw, ?url) and .svelte files must reach the guard instead of slipping out as externals
    external: (id) => BARE.test(id) && !inlined.has(pkgName(id)) && !JSQUASH_SUBPATH.test(id) && !/[?]|\.svelte/.test(id),
    plugins: [jsquashExt(), platformSwap(swaps, { strict: strictSwaps }), viteQueryGuard()],
    transform: { define },
    checks: { pluginTimings: false },
    logLevel: 'warn',
    onLog(level, log, handler) {
      // pdf.js and fontkit use eval-free but dynamic patterns rolldown likes to mention
      if (['EVAL', 'CIRCULAR_DEPENDENCY', 'MIXED_EXPORTS', 'INEFFECTIVE_DYNAMIC_IMPORT'].includes(log.code)) return;
      handler(level, log);
    },
    output: { dir: outDir, format: 'esm', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs', banner, minify: false },
  });
  const files = [];
  for (const f of await readdir(outDir)) if (f.endsWith('.mjs')) files.push([f, await readFile(join(outDir, f), 'utf8')]);
  const problems = scanDist(files);
  if (problems.length) throw new Error(`bundle guard:\n  ${problems.join('\n  ')}`);
  // every source module that ended up in the bundle, for the licence checks
  const modules = [...new Set(result.output.flatMap((c) => (c.type === 'chunk' ? c.moduleIds : [])))].filter((id) => !id.startsWith('\0')).map((id) => id.replaceAll('\\', '/'));
  return { files: files.map(([f]) => f), modules };
}

/** Evaluates src/tools/registry.ts at build time (Vite's import.meta.glob replaced) and returns its tools */
export async function loadRegistry(tmpDir) {
  const file = join(tmpDir, 'registry.mjs');
  await build({
    input: join(SITE_SRC, 'tools/registry.ts'),
    platform: 'node',
    resolve: { alias: { '@': SITE_SRC } },
    plugins: [viteGlob()],
    logLevel: 'silent',
    output: { file, format: 'esm' },
  });
  const { tools } = await import(/* @vite-ignore */ `${pathToFileURL(file).href}?t=${Date.now()}`);
  await rm(file, { force: true });
  return tools;
}

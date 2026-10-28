// Bundler plugins that let the npm packages import the site's own src/engines and src/tools/lib code unchanged.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SITE_SRC = join(REPO, 'src');

const norm = (p) => p.replaceAll('\\', '/').replace(/\?.*$/, '');
const inSite = (id) => norm(id).startsWith(norm(SITE_SRC) + '/');

const GLOB = /import\.meta\.glob<[^>]*>\('\.\/defs\/\*\.ts',\s*\{\s*eager:\s*true\s*\}\)/;

/**
 * Vite's eager `import.meta.glob('./defs/*.ts')` in src/tools/registry.ts, as static imports, so the registry can be
 * read at build time to generate the minimal catalog. Only the catalog script uses it; no package bundles the defs.
 */
export function viteGlob() {
  return {
    name: 'rounder:vite-glob',
    async load(id) {
      if (!norm(id).endsWith('src/tools/registry.ts')) return null;
      const src = await readFile(id, 'utf8');
      if (!GLOB.test(src)) this.error('registry.ts no longer has the import.meta.glob this plugin rewrites');
      const files = (await readdir(join(dirname(id), 'defs'))).filter((f) => f.endsWith('.ts')).sort();
      const imports = files.map((f, i) => `import * as __d${i} from './defs/${f}';`).join('\n');
      const obj = `{${files.map((f, i) => `'./defs/${f}': __d${i}`).join(',')}}`;
      return { code: `${imports}\n${src.replace(GLOB, obj)}`, moduleType: 'ts' };
    },
  };
}

/**
 * Swaps browser-only leaf modules for their Node twins. Keyed on the resolved absolute path, so it catches both
 * `@/engines/pdf/qpdf` and the barrel's relative `./qpdf`. `swaps` maps a path under src/ (no extension) to a file;
 * `strict` (true, or a list of those paths) fails the build when a swap goes unused.
 */
export function platformSwap(swaps, { strict = false } = {}) {
  const table = new Map(Object.entries(swaps).map(([site, twin]) => [norm(join(SITE_SRC, site)), twin]));
  const used = new Set();
  return {
    name: 'rounder:platform-swap',
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith('\0')) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r || r.external) return r;
      const twin = table.get(norm(r.id).replace(/\.(ts|js|mjs)$/, ''));
      if (!twin) return r;
      used.add(twin);
      return { id: twin };
    },
    buildEnd(error) {
      if (error) return;
      // a twin nothing asked for means a site refactor moved or renamed the leaf: fail rather than ship the browser version
      const required = strict === true ? [...table.keys()] : (strict || []).map((s) => norm(join(SITE_SRC, s)));
      for (const site of required) if (!used.has(table.get(site))) this.error(`nothing imported ${site}, so its Node twin went unused`);
    },
  };
}

const QUERY = /\?(url|raw|worker|sharedworker|inline)\b/;
const BROWSER_ONLY = [
  [/import\.meta\.env\b/, 'import.meta.env'],
  [/import\.meta\.glob\b/, 'import.meta.glob'],
  [/new\s+(Shared)?Worker\s*\(\s*new\s+URL\s*\(/, 'a Web Worker'],
];

/**
 * Fails the build when site code that only works in Vite or a browser reaches a package bundle: `?url`/`?raw`/`?worker`
 * imports, `.svelte` files, `import.meta.env`, `import.meta.glob` and `new Worker(new URL(...))`. A new browser-only
 * import in a shared module then breaks the SDK build loudly instead of shipping broken code.
 */
export function viteQueryGuard() {
  return {
    name: 'rounder:vite-query-guard',
    resolveId(source, importer) {
      if (!importer) return null;
      if (QUERY.test(source)) this.error(`${source} (a Vite-only import) reached a package bundle from ${importer}`);
      if (/\.svelte(\.[jt]s)?$/.test(source)) this.error(`${source} (UI code, AGPL only) reached a package bundle from ${importer}`);
      return null;
    },
    transform(code, id) {
      if (!inSite(id)) return null;
      for (const [re, what] of BROWSER_ONLY) if (re.test(code)) this.error(`${what} in ${norm(id)} reached a package bundle: swap the module for a Node twin`);
      return null;
    },
  };
}

/** Checks a finished bundle's text for what the guard is meant to keep out, in case a plugin or loader let it through */
export function scanDist(files) {
  const problems = [];
  for (const [name, text] of files) {
    if (/\?(url|raw|worker)['"]/.test(text)) problems.push(`${name}: a ?url/?raw/?worker import`);
    if (/import\.meta\.env\b/.test(text)) problems.push(`${name}: import.meta.env`);
    if (/\.svelte['"]/.test(text)) problems.push(`${name}: a .svelte import`);
    if (/["'](heic-to|libheif-js|heic-decode|mediabunny|@ffmpeg\/core|sharp|kokoro-js|phonemizer)["']/.test(text)) problems.push(`${name}: a copyleft dependency is imported or inlined`);
  }
  return problems;
}

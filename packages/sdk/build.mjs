// Builds @roundertools/sdk: bundles src/ with the site's engines, copies fonts and pdf.js data, writes the minimal
// catalog and the type declarations.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePackage, loadRegistry } from '@roundertools/build/bundle';
import { REPO } from '@roundertools/build';
import { checkSiteModules, inlinedPackages, licenseText } from '@roundertools/build/licenses';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);
const twin = (f) => join(here, 'src/platform/node', f);

const { modules } = await bundlePackage({
  input: { index: join(here, 'src/index.ts'), 'no-network': join(here, 'src/no-network.ts') },
  outDir: dist,
  // pure JS, permissive, and big when installed whole (pdfjs-dist would also pull in a 39 MB native canvas)
  inline: ['pdf-lib', '@pdf-lib/fontkit', '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'pako', 'tslib', 'pdfjs-dist', 'fflate', 'comlink', 'gifenc'],
  swaps: {
    'engines/pdf/qpdf': twin('qpdf.ts'),
    'engines/pdf/pdfjs-env': twin('pdfjs-env.ts'),
    'engines/pdf/fonts': twin('fonts.ts'),
    'engines/image/client': twin('image-client.ts'),
    'tools/lib/compress-pdf/runner': twin('compress-runner.ts'),
  },
  // the image client is swapped in case shared code imports it; the rest must be in use, or a site refactor moved them
  strictSwaps: ['engines/pdf/qpdf', 'engines/pdf/pdfjs-env', 'engines/pdf/fonts', 'tools/lib/compress-pdf/runner'],
  define: { __VERSION__: JSON.stringify(pkg.version) },
});

// the MIT grant covers exactly the site files bundled here (REUSE.toml); notices for what is inlined
const { site, problems } = checkSiteModules(modules);
const inlined = inlinedPackages(modules);
await writeFile(join(here, 'bundle-modules.json'), `${JSON.stringify({ site, inlined: inlined.map(({ dir, ...p }) => p) }, null, 1)}\n`);
if (process.argv.includes('--reuse-write')) await writeGrant(site);
else if (problems.length) throw new Error(`licence grant:\n  ${problems.join('\n  ')}\nList the bundled files in REUSE.toml with: node packages/sdk/build.mjs --reuse-write`);
await writeFile(join(here, 'THIRD_PARTY_NOTICES.md'), notices(inlined));

// fonts for stamping non-Latin text (OFL) and pdf.js's own data files (Apache-2.0)
const assets = join(dist, 'assets');
await mkdir(join(assets, 'fonts'), { recursive: true });
for (const f of ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf', 'OFL.txt']) await cp(join(REPO, 'public/fonts/pdf', f), join(assets, 'fonts', f));
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json', { paths: [REPO] }));
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) await cp(join(pdfjsRoot, d), join(assets, 'pdfjs', d), { recursive: true });

// the minimal catalog: names and presets only, never the site's page copy (titles, descriptions, FAQ, notes)
const tools = await loadRegistry(here);
const catalog = tools.map((t) => ({
  slug: t.slug,
  name: t.name,
  tagline: t.tagline,
  category: t.category,
  keywords: t.keywords,
  ...(t.variantOf ? { variantOf: t.variantOf } : {}),
  ...(t.props ? { props: t.props } : {}),
  ...(t.next ? { next: t.next } : {}),
}));
await writeFile(join(dist, 'catalog.json'), JSON.stringify(catalog));

// declarations for the public API: only this package's own files ship, and none may point into the site's src/
if (!process.argv.includes('--no-types')) {
  const tmp = join(dist, '.types');
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc', { paths: [REPO] }), '-p', join(here, 'tsconfig.build.json')], { stdio: 'inherit' });
  await cp(join(tmp, 'packages/sdk/src'), join(dist, 'types'), { recursive: true });
  await rm(tmp, { recursive: true, force: true });
  const leaks = [];
  for (const f of await readdir(join(dist, 'types'), { recursive: true })) {
    if (!f.endsWith('.d.ts')) continue;
    const text = await readFile(join(dist, 'types', f), 'utf8');
    if (/(from |import\()['"]@\//.test(text)) leaks.push(f.replaceAll('\\', '/'));
  }
  // the public entry may only reach declarations that resolve for users; impl/ and platform twins aren't public
  const reach = new Set();
  const walk = async (rel) => {
    if (reach.has(rel)) return;
    reach.add(rel);
    const text = await readFile(join(dist, 'types', rel), 'utf8');
    for (const [, spec] of text.matchAll(/(?:from |import\(|import )['"](\.[^'"]*)['"]/g)) {
      const target = join(dirname(rel), spec.replace(/\.js$/, ''));
      await walk((/^\.\.?$/.test(spec) ? join(target, 'index.d.ts') : `${target}.d.ts`).replaceAll('\\', '/'));
    }
  };
  await walk('index.d.ts');
  await walk('no-network.d.ts');
  const bad = leaks.filter((f) => reach.has(f));
  if (bad.length) throw new Error(`public declarations import site paths (@/…): ${bad.join(', ')}`);
  // what the entry can't reach (implementations, Node twins) has no business in the package
  for (const f of await readdir(join(dist, 'types'), { recursive: true })) {
    if (f.endsWith('.d.ts') && !reach.has(f.replaceAll('\\', '/'))) await rm(join(dist, 'types', f));
  }
  const dirs = (await readdir(join(dist, 'types'), { recursive: true, withFileTypes: true })).filter((d) => d.isDirectory());
  for (const d of dirs.reverse()) await rmdir(join(d.parentPath, d.name)).catch(() => {});
}
console.log(`@roundertools/sdk ${pkg.version} built: ${catalog.length} catalog entries`);

/** rewrites the MIT grant in REUSE.toml to the site files this package bundles */
async function writeGrant(files) {
  const path = join(REPO, 'REUSE.toml');
  const toml = await readFile(path, 'utf8');
  const list = files.toSorted().map((f) => `  "${f}",`).join('\n');
  const re = /(# begin: bundled site files[^\n]*\n(?:[^\n]*\n)*?path = \[\n)[\s\S]*?(\n?\])/;
  if (!re.test(toml)) throw new Error('REUSE.toml has no "# begin: bundled site files" block to update');
  await writeFile(path, toml.replace(re, `$1${list}\n]`));
}

function notices(packages) {
  const parts = [
    '# Third-party notices',
    '',
    "@roundertools/sdk is MIT-licensed. Its bundle includes code from the packages below (inlined, unmodified), the Noto",
    'Sans fonts (SIL Open Font License 1.1, in dist/assets/fonts) and pdf.js data files (Apache-2.0, in dist/assets/pdfjs).',
    'The dependencies installed next to it (jSquash, qpdf-wasm, zod, wasm-feature-detect) carry their own licences.',
    '',
  ];
  for (const p of packages) parts.push(`## ${p.name} ${p.version} (${p.license})`, '', '```', licenseText(p.dir) || `${p.license}: see https://www.npmjs.com/package/${p.name}`, '```', '');
  return parts.join('\n');
}

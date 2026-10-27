// Copies the fonts Word, Excel and PowerPoint to PDF lay pages out with into public/vendor/office-fonts.
// They are metric-compatible stand-ins for the usual Office fonts (OFL-1.1, via @fontsource):
//   Carlito = Calibri, Caladea = Cambria, Arimo = Arial/Helvetica, Tinos = Times New Roman, Cousine = Courier New
// The same WOFF files are used by the browser to lay the page out and embedded (subset) into the PDF, so text
// lands exactly where the browser put it. Every file is far below Cloudflare's 25 MB limit, so nothing is split.
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/vendor/office-fonts');
const FAMILIES = ['carlito', 'caladea', 'arimo', 'tinos', 'cousine'];
const VARIANTS = ['400-normal', '400-italic', '700-normal', '700-italic'];

const pkgs = await Promise.all(FAMILIES.map(async (f) => JSON.parse(await readFile(join(root, 'node_modules/@fontsource', f, 'package.json'), 'utf8'))));
const version = pkgs.map((p) => `${p.name}@${p.version}`).join(' ');
const manifestPath = join(out, 'manifest.json');
const previous = await readFile(manifestPath, 'utf8').then(JSON.parse, () => null);
if (previous?.version === version) {
  console.log('vendor-office: up to date');
  process.exit(0);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const manifest = { version, families: {} };
let bytes = 0;
for (const family of FAMILIES) {
  const dir = join(root, 'node_modules/@fontsource', family);
  const ranges = JSON.parse(await readFile(join(dir, 'unicode.json'), 'utf8'));
  const files = new Set(await readdir(join(dir, 'files')));
  const faces = [];
  for (const [subset, range] of Object.entries(ranges))
    for (const variant of VARIANTS) {
      const file = `${family}-${subset}-${variant}.woff`;
      if (!files.has(file)) continue;
      await copyFile(join(dir, 'files', file), join(out, file));
      bytes += (await readFile(join(out, file))).length;
      const [weight, style] = variant.split('-');
      faces.push({ subset, weight: Number(weight), style, file, range });
    }
  manifest.families[family] = faces;
  await copyFile(join(dir, 'LICENSE'), join(out, `${family}-LICENSE.txt`));
}
await writeFile(manifestPath, JSON.stringify(manifest) + '\n');
console.log(`vendor-office: ${FAMILIES.length} font families, ${(bytes / 1048576).toFixed(1)} MB`);

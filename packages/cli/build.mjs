// Builds the roundertools CLI. The SDK stays an external dependency; nothing from the site is bundled here directly.
import { chmod, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePackage } from '@roundertools/build/bundle';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));

await bundlePackage({
  input: { bin: join(here, 'src/bin.ts'), main: join(here, 'src/main.ts') },
  outDir: join(here, 'dist'),
  siteAlias: false,
  banner: (chunk) => (chunk.fileName === 'bin.mjs' ? '#!/usr/bin/env node' : ''),
  define: { __VERSION__: JSON.stringify(pkg.version) },
});
await chmod(join(here, 'dist/bin.mjs'), 0o755);
console.log(`roundertools ${pkg.version} built`);

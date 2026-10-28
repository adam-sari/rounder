// Builds @roundertools/mcp. The SDK and the MCP SDK stay external dependencies.
import { execFileSync } from 'node:child_process';
import { chmod, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO } from '@roundertools/build';
import { bundlePackage } from '@roundertools/build/bundle';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf8'));

await bundlePackage({
  input: { bin: join(here, 'src/bin.ts'), server: join(here, 'src/main.ts') },
  outDir: join(here, 'dist'),
  siteAlias: false,
  banner: (chunk) => (chunk.fileName === 'bin.mjs' ? '#!/usr/bin/env node' : ''),
});
await chmod(join(here, 'dist/bin.mjs'), 0o755);
// declarations for the programmatic export (createServer, Access); they import the SDK's own types by name
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc', { paths: [REPO] });
execFileSync(process.execPath, [tsc, '-p', join(here, 'tsconfig.build.json')], { stdio: 'inherit' });
console.log(`@roundertools/mcp ${pkg.version} built`);

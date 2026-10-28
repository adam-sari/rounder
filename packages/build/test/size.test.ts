import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../src/index.mjs';

// what `npx roundertools` downloads matters: these budgets fail the build instead of drifting
const BUDGET = { '@roundertools/sdk': 14e6, roundertools: 200e3, '@roundertools/mcp': 200e3 };

function pack(workspace: string) {
  const out = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '-w', workspace], { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0] as { unpackedSize: number; files: { path: string }[] };
}

describe.runIf(existsSync(join(REPO, 'packages/sdk/dist/index.mjs')))('package contents', () => {
  it.each(Object.entries(BUDGET))('%s stays under its size budget', (name, budget) => {
    expect(pack(name).unpackedSize).toBeLessThan(budget);
  });

  it('ships the built files, licences and docs, and no sources, tests or site code', () => {
    for (const name of Object.keys(BUDGET)) {
      const files = pack(name).files.map((f) => f.path);
      expect(files).toEqual(expect.arrayContaining(['LICENSE', 'README.md', 'package.json']));
      expect(files.filter((f) => /^(src|test)\/|\.svelte|bundle-modules/.test(f))).toEqual([]);
    }
    expect(pack('@roundertools/sdk').files.map((f) => f.path)).toEqual(expect.arrayContaining(['dist/index.mjs', 'dist/no-network.mjs', 'dist/types/index.d.ts', 'dist/catalog.json', 'THIRD_PARTY_NOTICES.md']));
    expect(pack('roundertools').files.map((f) => f.path)).toEqual(expect.arrayContaining(['dist/bin.mjs', 'skill/SKILL.md']));
    expect(pack('@roundertools/mcp').files.map((f) => f.path)).toEqual(expect.arrayContaining(['dist/bin.mjs', 'dist/server.mjs', 'dist/types/main.d.ts']));
  });
});

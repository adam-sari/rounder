import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, SITE_SRC } from '../src/index.mjs';
import { checkSiteModules, COPYLEFT, FORBIDDEN, grantedPaths, PACKAGES, productionTree } from '../src/licenses.mjs';
import { loadRegistry } from '../src/bundle.mjs';

const dirs: Record<string, string> = { '@roundertools/sdk': 'sdk', roundertools: 'cli', '@roundertools/mcp': 'mcp' };
const pkgDir = (name: string) => join(REPO, 'packages', dirs[name]);
const sdkDist = join(REPO, 'packages/sdk/dist');
const built = existsSync(join(REPO, 'packages/sdk/bundle-modules.json'));

describe('package licences', () => {
  it.each(PACKAGES)('%s is MIT, with the licence file it ships', (name) => {
    const pkg = JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf8'));
    expect(pkg.name).toBe(name);
    expect(pkg.license).toBe('MIT');
    expect(pkg.files).toContain('LICENSE');
    expect(readFileSync(join(pkgDir(name), 'LICENSE'), 'utf8')).toMatch(/^MIT License/);
  });

  it.each(PACKAGES)('everything `npm i %s` installs is permissively licensed', (name) => {
    const tree = productionTree(name);
    expect(tree.length).toBeGreaterThan(1);
    const bad = tree.filter((p) => !p.license || COPYLEFT.test(p.license)).map((p) => `${p.name}@${p.version}: ${p.license || 'no licence'}`);
    expect(bad).toEqual([]);
  });

  it('copyleft libraries are never dependencies, only (at most) things a user installs on their own', () => {
    for (const name of PACKAGES) {
      const pkg = JSON.parse(readFileSync(join(pkgDir(name), 'package.json'), 'utf8'));
      const declared = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies });
      expect(declared.filter((d) => /^(mediabunny|heic-to|libheif-js|heic-decode|@ffmpeg\/|ffmpeg-static|@napi-rs\/webcodecs|kokoro-js|phonemizer|sharp)/.test(d))).toEqual([]);
    }
  });
});

describe('the MIT grant on site files (REUSE.toml)', () => {
  const granted = grantedPaths();

  it('lists only TypeScript engine and library files that exist', () => {
    expect(granted.length).toBeGreaterThan(10);
    for (const p of granted) {
      expect(p).toMatch(/^src\/(engines|tools\/lib)\/.+\.ts$/);
      expect(FORBIDDEN.some((re) => re.test(p))).toBe(false);
      expect(existsSync(join(REPO, p))).toBe(true);
    }
  });

  it.runIf(built)('covers exactly the site files the SDK bundles', () => {
    const { site } = JSON.parse(readFileSync(join(REPO, 'packages/sdk/bundle-modules.json'), 'utf8')) as { site: string[] };
    const { problems } = checkSiteModules(site.map((s) => `${REPO.replaceAll('\\', '/')}/${s}`));
    expect(problems).toEqual([]);
    expect([...granted].sort()).toEqual([...site].sort());
  });

  it.runIf(built)('inlines only permissive packages', () => {
    const { inlined } = JSON.parse(readFileSync(join(REPO, 'packages/sdk/bundle-modules.json'), 'utf8')) as { inlined: { name: string; license: string }[] };
    expect(inlined.filter((p) => COPYLEFT.test(p.license) || !p.license)).toEqual([]);
  });
});

describe.runIf(built)('page copy stays on the site', () => {
  it('no title, description or FAQ answer from src/tools/defs ends up in the SDK', async () => {
    const tools = (await loadRegistry(join(REPO, 'packages/build/test'))) as { title: string; description: string; h1: string; faq: { a: string }[] }[];
    const files = readdirSync(sdkDist).filter((f) => f.endsWith('.mjs') || f.endsWith('.json')).map((f) => readFileSync(join(sdkDist, f), 'utf8'));
    const copy = tools.flatMap((t) => [t.description, ...t.faq.map((f) => f.a)]).filter((s) => s.length > 60);
    const leaked = copy.filter((s) => files.some((text) => text.includes(s)));
    expect(leaked).toEqual([]);
    expect(SITE_SRC).toContain('src');
  });

  it('the catalog carries only the fields the CLI and MCP need', () => {
    const catalog = JSON.parse(readFileSync(join(sdkDist, 'catalog.json'), 'utf8')) as Record<string, unknown>[];
    const keys = new Set(catalog.flatMap((t) => Object.keys(t)));
    expect([...keys].sort()).toEqual(['category', 'keywords', 'name', 'next', 'props', 'slug', 'tagline', 'variantOf']);
  });
});

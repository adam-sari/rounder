// Licence checks for the npm packages: the MIT grant on bundled site files, and no copyleft in what users install.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO } from './index.mjs';

export const PACKAGES = ['@roundertools/sdk', 'roundertools', '@roundertools/mcp'];
export const COPYLEFT = /\b(A?GPL|LGPL|MPL|SSPL|EUPL|OSL|CDDL|EPL|CC-BY-SA|CC-BY-NC)\b|SEE LICEN[CS]E|UNLICENSED/i;

const rel = (p) => relative(REPO, p).replaceAll('\\', '/');

/** the paths REUSE.toml grants as "AGPL-3.0-only OR MIT": exactly the site files the packages bundle */
export function grantedPaths() {
  const toml = readFileSync(join(REPO, 'REUSE.toml'), 'utf8');
  const block = toml.split('[[annotations]]').find((b) => /SPDX-License-Identifier\s*=\s*"AGPL-3\.0-only OR MIT"/.test(b));
  if (!block) return [];
  const list = /path\s*=\s*\[([\s\S]*?)\]/.exec(block)?.[1] ?? '';
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** site files that may never ship in a package, whatever the grant says */
export const FORBIDDEN = [/\.svelte(\.ts)?$/, /^src\/tools\/defs\//, /^src\/tools\/registry\.ts$/, /^src\/engines\/ai\/lab\//, /^src\/tools\/lib\/recorder\/attach\.ts$/, /^src\/(pages|components|layouts|styles|seo)\//];

/** problems with a bundle's site modules: outside the grant, or never allowed */
export function checkSiteModules(modules) {
  const granted = new Set(grantedPaths());
  const site = modules.filter((m) => m.startsWith(`${REPO.replaceAll('\\', '/')}/src/`)).map((m) => rel(m));
  const problems = [];
  for (const m of site) {
    if (FORBIDDEN.some((re) => re.test(m))) problems.push(`${m} is UI or page copy and must not be bundled`);
    else if (!granted.has(m)) problems.push(`${m} is bundled but not in REUSE.toml's MIT grant`);
  }
  return { site, problems };
}

/** npm packages inlined into a bundle: name, version, licence, and the folder they came from */
export function inlinedPackages(modules) {
  const out = new Map();
  for (const m of modules) {
    const i = m.lastIndexOf('/node_modules/');
    if (i < 0) continue;
    const rest = m.slice(i + 14).split('/');
    const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    const dir = `${m.slice(0, i)}/node_modules/${name}`;
    if (out.has(name)) continue;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    out.set(name, { name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? ''), dir });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** every package a user installs with `npm i <pkg>` (no dev dependencies), with its licence */
export function productionTree(workspace) {
  let text = '';
  try {
    text = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--omit=dev', '--omit=peer', '--all', '--parseable', '-w', workspace], { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    text = e.stdout ?? '';
  }
  const seen = new Map();
  for (const dir of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const file = join(dir, 'package.json');
    if (!existsSync(file) || rel(dir) === '') continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? (pkg.licenses ?? []).map((l) => l.type).join(' OR '));
    seen.set(`${pkg.name}@${pkg.version}`, { name: pkg.name, version: pkg.version, license: license || '' });
  }
  return [...seen.values()];
}

/** the licence text a package ships, for THIRD_PARTY_NOTICES.md */
export function licenseText(dir) {
  for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE', 'COPYING']) if (existsSync(join(dir, f))) return readFileSync(join(dir, f), 'utf8').trim();
  return '';
}

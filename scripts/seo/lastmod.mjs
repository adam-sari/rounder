// Keeps src/seo/lastmod.json: the date each page source last changed, for sitemap <lastmod>.
// A source's date moves only when its content hash does, so rebuilding unchanged code leaves every date alone.
// The new date is the file's last commit date when the file is committed as is, otherwise today.
// Runs at the start of `astro build` (see astro.config.mjs), or by hand: node scripts/seo/lastmod.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST = 'src/seo/lastmod.json';

/** every file a sitemap page is built from, relative to the root with forward slashes */
export function sources(root) {
  const list = (dir, keep) => readdirSync(join(root, dir)).filter(keep).map((f) => `${dir}/${f}`);
  return [
    'src/tools/registry.ts',
    ...list('src/tools/defs', (f) => f.endsWith('.ts')),
    ...list('src/pages', (f) => f.endsWith('.astro') && !f.startsWith('[')),
    // the developer docs, the one folder of pages the sitemap lists (src/seo/sitemaps.ts)
    ...(existsSync(join(root, 'src/pages/developers')) ? list('src/pages/developers', (f) => f.endsWith('.astro')) : []),
  ].sort();
}

/** line endings are normalised so a Windows checkout hashes the same as the Linux build */
export const hash = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

/** keeps an entry while its hash matches, dates changed or new files with dateOf, and drops removed files */
export function nextManifest(prev, hashes, dateOf) {
  return Object.fromEntries(
    Object.keys(hashes).sort().map((file) => [
      file,
      prev[file]?.hash === hashes[file] ? prev[file] : { hash: hashes[file], lastmod: dateOf(file) },
    ]),
  );
}

/** last commit date (YYYY-MM-DD) of each file that is committed and unmodified; empty without git */
function gitDates(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const dirty = new Set(git('status', '--porcelain', '--', 'src').split('\n').map((l) => l.slice(3).trim()));
    const dates = new Map();
    let date = '';
    for (const line of git('log', '--format=@%cs', '--name-only', '--', 'src/tools', 'src/pages').split('\n')) {
      if (line.startsWith('@')) date = line.slice(1);
      else if (line && !dates.has(line) && !dirty.has(line)) dates.set(line, date);
    }
    return dates;
  } catch {
    return new Map();
  }
}

export function updateLastmod(root = process.cwd()) {
  const path = join(root, MANIFEST);
  const prev = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const hashes = Object.fromEntries(sources(root).map((f) => [f, hash(readFileSync(join(root, f), 'utf8'))]));
  let dates;
  const today = new Date().toISOString().slice(0, 10);
  const next = nextManifest(prev, hashes, (file) => (dates ??= gitDates(root)).get(file) ?? today);
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
  return next;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const m = updateLastmod();
  console.log(`lastmod: ${Object.keys(m).length} sources in ${MANIFEST}`);
}

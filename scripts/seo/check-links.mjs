// Checks a production build: every URL in the sitemaps is a real page with at least one plain <a> link to it from
// another page (the ⌘K palette isn't crawlable), and no internal link points at a missing file.
// Usage: node scripts/seo/check-links.mjs [distDir]   (default: dist)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const ORIGIN = 'https://roundertools.com';

const read = (path) => readFileSync(join(dist, path), 'utf8');
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replaceAll('&amp;', '&'));
/** "/x" for a page URL, "/" for the home page */
const pathOf = (url) => {
  const p = new URL(url, ORIGIN).pathname.replace(/\/$/, '').replace(/\.html$/, '').replace(/\/index$/, '');
  return p || '/';
};
const fileFor = (path) => (path === '/' ? 'index.html' : `${path.slice(1)}.html`);
const exists = (path) => existsSync(join(dist, path)) || existsSync(join(dist, fileFor(path))) || existsSync(join(dist, path, 'index.html'));

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? htmlFiles(join(dir, d.name)) : d.name.endsWith('.html') ? [join(dir, d.name)] : [],
  );
}

const sitemapUrls = locs(read('sitemap-index.xml')).flatMap((child) => locs(read(new URL(child).pathname.slice(1))));
const inbound = new Map();
const broken = [];

for (const file of htmlFiles(dist)) {
  const from = pathOf(`/${relative(dist, file).split(sep).join('/')}`);
  for (const [, href] of readFileSync(file, 'utf8').matchAll(/<a\b[^>]*?\shref=["']([^"'#][^"']*)["']/g)) {
    const url = new URL(href, ORIGIN + (from === '/' ? '/' : from));
    if (url.origin !== ORIGIN) continue;
    const to = pathOf(url.pathname);
    if (!exists(decodeURIComponent(url.pathname)) && !exists(to)) broken.push(`${from} → ${href}`);
    if (to !== from) (inbound.get(to) ?? inbound.set(to, new Set()).get(to)).add(from);
  }
}

const missing = sitemapUrls.map(pathOf).filter((p) => !existsSync(join(dist, fileFor(p))));
const orphans = sitemapUrls.map(pathOf).filter((p) => !inbound.get(p)?.size);

console.log(`check-links: ${sitemapUrls.length} sitemap URLs, ${inbound.size} linked paths`);
for (const [label, list] of [['sitemap URLs with no page', missing], ['sitemap URLs with no inbound <a>', orphans], ['broken internal links', broken]]) {
  if (list.length) console.error(`✗ ${label} (${list.length}):\n  ${[...new Set(list)].slice(0, 50).join('\n  ')}`);
}
if (missing.length || orphans.length || broken.length) process.exit(1);
console.log('✓ every sitemap URL is a page with at least one internal link, and no internal link is broken');

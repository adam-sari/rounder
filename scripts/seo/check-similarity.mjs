// Duplicate-content check for a production build: no two pages may share more than 80% of their main text.
// Main text = everything inside <main>, minus markup, scripts, the breadcrumb, the tool itself (its server-rendered
// shell is the same "warming up" stub everywhere) and the "More … tools" cards, which repeat other pages' taglines.
// Similarity is the Jaccard index of word 5-gram shingles, the usual near-duplicate measure.
// Usage: node scripts/seo/check-similarity.mjs [distDir] [maxSimilarity=0.8]
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = process.argv[2] ?? 'dist';
const MAX = Number(process.argv[3] ?? 0.8);
const N = 5;
// pages that aren't content: dev labs, embeds, error and offline pages
const SKIP = /^(dev|embed|og)\/|^(404|offline)\.html$/;

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? htmlFiles(join(dir, d.name)) : d.name.endsWith('.html') ? [join(dir, d.name)] : [],
  );
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** the visible text of a page's <main>, without the parts every tool page shares */
export function mainText(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
  return main
    .replace(/<(script|style|svg|template|nav)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<section\b[^>]*aria-label="Tool"[\s\S]*?<\/section>/i, ' ')
    .replace(/<section\b[^>]*>\s*<h2\b[^>]*>More [^<]*<\/h2>[\s\S]*?<\/section>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENTITIES[e] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** word n-gram shingles, lowercased, punctuation dropped */
export function shingles(text, n = N) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let both = 0;
  for (const s of small) if (big.has(s)) both++;
  return both / (a.size + b.size - both);
}

// run as a script, not when imported by tests
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pages = htmlFiles(dist)
    .map((file) => ({ path: relative(dist, file).split(sep).join('/'), file }))
    .filter((p) => !SKIP.test(p.path))
    .map((p) => ({ ...p, set: shingles(mainText(readFileSync(p.file, 'utf8'))) }))
    .filter((p) => p.set.size > 0);

  const pairs = [];
  let top = { score: 0 };
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i];
      const b = pages[j];
      const score = jaccard(a.set, b.set);
      if (score > top.score) top = { score, a: a.path, b: b.path };
      if (score > MAX) pairs.push({ score, a: a.path, b: b.path });
    }
  }

  console.log(`check-similarity: ${pages.length} pages; most similar pair ${top.a} ↔ ${top.b} at ${(top.score * 100).toFixed(1)}%`);
  if (pairs.length) {
    console.error(`✗ ${pairs.length} page pairs share more than ${MAX * 100}% of their main text:`);
    for (const p of pairs.sort((x, y) => y.score - x.score).slice(0, 50)) console.error(`  ${(p.score * 100).toFixed(1)}%  ${p.a} ↔ ${p.b}`);
    process.exit(1);
  }
  console.log(`✓ no two pages share more than ${MAX * 100}% of their main text`);
}

import lastmod from './lastmod.json';
import { tools, toolsIn, toolSource } from '@/tools/registry';
import { categories, categoryPath } from '@/tools/categories';
import { latest, type SitemapEntry } from './sitemap';

// What goes in each child sitemap. Dates come from src/seo/lastmod.json (kept by scripts/seo/lastmod.mjs).

export const SECTIONS = ['tools', 'variants', 'pages'] as const;
export type Section = (typeof SECTIONS)[number];

const dateOf = (file: string): string | undefined => (lastmod as Record<string, { lastmod: string }>)[file]?.lastmod;

// top-level pages left out: the home page is listed by hand, 404 and offline are noindex app shells
const skip = new Set(['index', '404', 'offline']);
const staticPages = Object.keys(import.meta.glob('/src/pages/*.astro'))
  .map((p) => p.slice('/src/pages/'.length, -'.astro'.length))
  .filter((name) => !name.startsWith('[') && !skip.has(name))
  .sort();

export function sitemapSections(site: URL): Record<Section, SitemapEntry[]> {
  const at = (path: string) => new URL(path, site).href;
  const toolDate = (slug: string) => dateOf(toolSource[slug]);
  const entry = (slug: string) => ({ loc: at(`/${slug}`), lastmod: toolDate(slug) });
  const main = tools.filter((t) => !t.variantOf);
  return {
    tools: main.map((t) => entry(t.slug)),
    variants: tools.filter((t) => t.variantOf).map((t) => entry(t.slug)),
    pages: [
      { loc: at('/'), lastmod: latest([dateOf('src/pages/index.astro'), ...main.map((t) => toolDate(t.slug))]) },
      ...categories
        .filter((c) => toolsIn(c.id).length > 0)
        .map((c) => ({ loc: at(categoryPath(c.id)), lastmod: latest(tools.filter((t) => t.category === c.id).map((t) => toolDate(t.slug))) })),
      ...staticPages.map((name) => ({ loc: at(`/${name}`), lastmod: dateOf(`src/pages/${name}.astro`) })),
    ],
  };
}

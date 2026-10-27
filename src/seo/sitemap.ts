// Sitemap XML builders. Pure, so they are unit-tested; the routes live in src/pages/sitemap-*.xml.ts.
// No <priority> or <changefreq>: Google ignores both.

export interface SitemapEntry {
  loc: string;
  /** YYYY-MM-DD */
  lastmod?: string;
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

const entries = (tag: string, list: SitemapEntry[]) =>
  list
    .map((e) => `<${tag}><loc>${escape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</${tag}>`)
    .join('\n');

const xml = (root: string, tag: string, list: SitemapEntry[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries(tag, list)}\n</${root}>\n`;

export const urlset = (list: SitemapEntry[]) => xml('urlset', 'url', list);
export const sitemapIndex = (list: SitemapEntry[]) => xml('sitemapindex', 'sitemap', list);

/** the newest of some YYYY-MM-DD dates (they sort as strings) */
export const latest = (dates: (string | undefined)[]) =>
  dates.reduce<string | undefined>((max, d) => (d && (!max || d > max) ? d : max), undefined);

export const xmlResponse = (body: string) => new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });

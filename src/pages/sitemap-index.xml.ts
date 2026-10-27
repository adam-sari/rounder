import type { APIRoute } from 'astro';
import { latest, sitemapIndex, xmlResponse } from '@/seo/sitemap';
import { SECTIONS, sitemapSections } from '@/seo/sitemaps';

export const GET: APIRoute = ({ site }) => {
  const sections = sitemapSections(site!);
  return xmlResponse(
    sitemapIndex(SECTIONS.map((name) => ({ loc: new URL(`/sitemap-${name}.xml`, site).href, lastmod: latest(sections[name].map((e) => e.lastmod)) }))),
  );
};

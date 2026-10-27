import type { APIRoute } from 'astro';
import { urlset, xmlResponse } from '@/seo/sitemap';
import { SECTIONS, sitemapSections, type Section } from '@/seo/sitemaps';

// sitemap-tools.xml, sitemap-variants.xml and sitemap-pages.xml, listed by sitemap-index.xml
export const getStaticPaths = () => SECTIONS.map((section) => ({ params: { section } }));

export const GET: APIRoute = ({ site, params }) => xmlResponse(urlset(sitemapSections(site!)[params.section as Section]));

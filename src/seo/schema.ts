import { SITE } from '@/site';
import type { Faq } from '@/tools/types';
import { aggregateRating, type Rating } from '@/seo/ratings';

// JSON-LD builders. Pure (site URL in, plain objects out), so they are unit-tested.

const ctx = 'https://schema.org';

/** the names Google may use for the site: "Rounder" alone is Rounder Records' entity, so the brand goes with them */
export const alternateNames = (site: URL) => [SITE.alternateName, site.host];

const orgId = (site: URL) => new URL('/#organization', site).href;

/** a short Organization to point at from other pages */
export const publisher = (site: URL) => ({ '@type': 'Organization', '@id': orgId(site), name: SITE.name, url: site.href });

export function organization(site: URL) {
  const sameAs = [SITE.github, ...SITE.sameAs].filter(Boolean);
  return {
    '@context': ctx,
    ...publisher(site),
    alternateName: alternateNames(site),
    logo: new URL('/icons/icon-512.png', site).href,
    email: SITE.email,
    ...(sameAs.length > 0 && { sameAs }),
    ...(SITE.owner.name && { founder: { '@type': 'Person', name: SITE.owner.name } }),
  };
}

export const website = (site: URL, description: string) => ({
  '@context': ctx,
  '@type': 'WebSite',
  name: SITE.name,
  alternateName: alternateNames(site),
  url: site.href,
  description,
  publisher: { '@id': orgId(site) },
});

/** rating: real visitor ratings only, and only once shownRating() lets the page show them too (src/seo/ratings.ts) */
export const webApplication = (site: URL, { rating, ...app }: { name: string; url: string; description: string; rating?: Rating | null }) => ({
  '@context': ctx,
  '@type': 'WebApplication',
  ...app,
  applicationCategory: 'UtilitiesApplication',
  operatingSystem: 'Any (runs in the browser)',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: publisher(site),
  ...(rating && { aggregateRating: aggregateRating(rating) }),
});

export const faqPage = (faq: Faq[]) => ({
  '@context': ctx,
  '@type': 'FAQPage',
  mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

export const breadcrumbs = (items: { name: string; url: string }[]) => ({
  '@context': ctx,
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: item.url })),
});

/** JSON-LD is raw text inside <script>, so a "</script>" or "<!--" in any FAQ or description must not end it early */
export const jsonLd = (data: object) => JSON.stringify(data).replace(/</g, '\\u003c');

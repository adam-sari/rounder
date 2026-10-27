import { describe, expect, it } from 'vitest';
import { breadcrumbs, jsonLd, faqPage, organization, webApplication, website } from '@/seo/schema';

const site = new URL('https://roundertools.com');

describe('JSON-LD', () => {
  it('names the brand with its alternate names on WebSite and Organization', () => {
    const names = ['Rounder Tools', 'roundertools.com'];
    expect(website(site, 'd')).toMatchObject({ '@type': 'WebSite', name: 'Rounder', alternateName: names, url: 'https://roundertools.com/' });
    const org = organization(site);
    expect(org).toMatchObject({ '@type': 'Organization', '@id': 'https://roundertools.com/#organization', alternateName: names });
    expect(org.logo).toBe('https://roundertools.com/icons/icon-512.png');
    expect(org.email).toBe('hello@roundertools.com');
  });

  it('leaves out an empty owner name and empty profiles', () => {
    const org = organization(site) as Record<string, unknown>;
    expect(org.founder).toBeUndefined();
    expect((org.sameAs as string[]).every(Boolean)).toBe(true);
  });

  it('describes a tool as a free utility app published by the organization', () => {
    const app = webApplication(site, { name: 'Compress PDF', url: 'https://roundertools.com/compress-pdf', description: 'd' });
    expect(app).toMatchObject({
      '@type': 'WebApplication',
      applicationCategory: 'UtilitiesApplication',
      offers: { '@type': 'Offer', price: '0' },
      publisher: { '@type': 'Organization', '@id': 'https://roundertools.com/#organization' },
    });
    expect(app).not.toHaveProperty('aggregateRating');
  });

  it('builds FAQ and breadcrumb lists', () => {
    expect(faqPage([{ q: 'Q?', a: 'A.' }]).mainEntity[0]).toEqual({ '@type': 'Question', name: 'Q?', acceptedAnswer: { '@type': 'Answer', text: 'A.' } });
    expect(breadcrumbs([{ name: 'a', url: 'u1' }, { name: 'b', url: 'u2' }]).itemListElement.map((i) => i.position)).toEqual([1, 2]);
  });

  it('keeps JSON-LD text from closing its script tag', () => {
    const text = jsonLd(faqPage([{ q: 'Is </script><!-- safe?', a: 'Yes.' }]));
    expect(text).not.toMatch(/</);
    expect(JSON.parse(text).mainEntity[0].name).toBe('Is </script><!-- safe?');
  });
});

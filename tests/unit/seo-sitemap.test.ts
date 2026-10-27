import { describe, expect, it } from 'vitest';
import { latest, sitemapIndex, urlset } from '@/seo/sitemap';

describe('sitemap xml', () => {
  it('writes a urlset with lastmod and escaped locs, and no priority or changefreq', () => {
    const xml = urlset([{ loc: 'https://roundertools.com/a?b=1&c=2', lastmod: '2026-10-27' }, { loc: 'https://roundertools.com/' }]);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
    expect(xml).toContain('<url><loc>https://roundertools.com/a?b=1&amp;c=2</loc><lastmod>2026-10-27</lastmod></url>');
    expect(xml).toContain('<url><loc>https://roundertools.com/</loc></url>');
    expect(xml).not.toMatch(/priority|changefreq/);
  });

  it('writes a sitemap index', () => {
    const xml = sitemapIndex([{ loc: 'https://roundertools.com/sitemap-tools.xml', lastmod: '2026-10-01' }]);
    expect(xml).toContain('<sitemapindex ');
    expect(xml).toContain('<sitemap><loc>https://roundertools.com/sitemap-tools.xml</loc><lastmod>2026-10-01</lastmod></sitemap>');
  });

  it('picks the newest date and skips missing ones', () => {
    expect(latest(['2026-01-02', undefined, '2026-10-27', '2025-12-31'])).toBe('2026-10-27');
    expect(latest([undefined])).toBeUndefined();
  });
});

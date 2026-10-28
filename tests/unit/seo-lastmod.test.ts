import { describe, expect, it } from 'vitest';
import { hash, nextManifest, sources } from '../../scripts/seo/lastmod.mjs';

describe('lastmod manifest', () => {
  const prev = { 'a.ts': { hash: 'h1', lastmod: '2026-01-01' }, 'gone.ts': { hash: 'h9', lastmod: '2026-01-01' } };

  it('keeps the date while the hash is unchanged, so rebuilding changes nothing', () => {
    expect(nextManifest(prev, { 'a.ts': 'h1' }, () => '2026-10-27')).toEqual({ 'a.ts': { hash: 'h1', lastmod: '2026-01-01' } });
  });

  it('dates changed and new files, and drops removed ones', () => {
    const next = nextManifest(prev, { 'b.ts': 'h3', 'a.ts': 'h2' }, (f: string) => (f === 'a.ts' ? '2026-10-20' : '2026-10-27'));
    expect(next).toEqual({ 'a.ts': { hash: 'h2', lastmod: '2026-10-20' }, 'b.ts': { hash: 'h3', lastmod: '2026-10-27' } });
    expect(Object.keys(next)).toEqual(['a.ts', 'b.ts']);
  });

  it('hashes CRLF and LF checkouts the same', () => {
    expect(hash('a\r\nb\r\n')).toBe(hash('a\nb\n'));
    expect(hash('a')).not.toBe(hash('b'));
  });

  it('covers every page the sitemap dates, the developer docs included', () => {
    const list = sources('.');
    expect(list).toEqual(expect.arrayContaining(['src/pages/about.astro', 'src/pages/developers/index.astro', 'src/pages/developers/mcp.astro']));
    expect(list.some((f: string) => f.includes('['))).toBe(false);
  });
});

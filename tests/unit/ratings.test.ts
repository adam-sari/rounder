import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { COMMENT_MAX, cleanComment, parseRating, promptKey, promptState, rememberPrompt } from '@/tools/lib/rating';
import { MIN_RATINGS, aggregateRating, ratingLabel, shownRating } from '@/seo/ratings';
import { webApplication } from '@/seo/schema';
import { normalize, snapshot } from '../../scripts/seo/ratings.mjs';

describe('rating input', () => {
  it('accepts 1–5 whole stars and an optional short comment', () => {
    expect(parseRating({ slug: 'merge-pdf', stars: 5 })).toEqual({ ok: true, value: { slug: 'merge-pdf', stars: 5, comment: '' } });
    expect(parseRating({ slug: 'merge-pdf', stars: 1, comment: ' a\u0000b\u202e c ' })).toEqual({ ok: true, value: { slug: 'merge-pdf', stars: 1, comment: 'a b c' } });
    expect(parseRating({ slug: 'merge-pdf', stars: 3, comment: '😀'.repeat(COMMENT_MAX) }).ok).toBe(true);
    for (const bad of [null, [], 'x', { slug: 'merge-pdf' }, { slug: 'merge-pdf', stars: 0 }, { slug: 'merge-pdf', stars: NaN },
      { slug: 'Merge', stars: 3 }, { slug: 'a--b', stars: 3 }, { slug: 'merge-pdf', stars: 3, comment: 5 },
      { slug: 'merge-pdf', stars: 3, comment: 'x'.repeat(COMMENT_MAX + 1) }]) {
      expect(parseRating(bad).ok).toBe(false);
    }
  });

  it('cleans comments', () => {
    expect(cleanComment('\n\n  hello\t\tthere \r\n')).toBe('hello there');
  });
});

describe('rating prompt memory', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it('remembers per tool whether it was answered or closed', () => {
    const s = store();
    expect(promptState(s, 'merge-pdf')).toBeNull();
    rememberPrompt(s, 'merge-pdf', 'dismissed');
    rememberPrompt(s, 'png-to-jpg', 'rated');
    expect(promptState(s, 'merge-pdf')).toBe('dismissed');
    expect(promptState(s, 'png-to-jpg')).toBe('rated');
    expect(promptState(s, 'word-counter')).toBeNull();
    expect(s.m.get(promptKey('png-to-jpg'))).toBe('rated');
    s.m.set(promptKey('word-counter'), 'junk');
    expect(promptState(s, 'word-counter')).toBeNull();
  });

  it('asks anyway when storage is missing or blocked', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(promptState(blocked, 'merge-pdf')).toBeNull();
    expect(() => rememberPrompt(blocked, 'merge-pdf', 'rated')).not.toThrow();
    expect(promptState(undefined, 'merge-pdf')).toBeNull();
  });
});

describe('ratings on the page', () => {
  const site = new URL('https://roundertools.com');
  const all = { 'merge-pdf': { avg: 4.8333, count: 123 }, 'png-to-jpg': { avg: 5, count: MIN_RATINGS - 1 }, odd: { avg: 9, count: 50 } };

  it('shows a rating only from MIN_RATINGS real ratings on, rounded the same on the page and in the markup', () => {
    expect(MIN_RATINGS).toBe(20);
    const r = shownRating('merge-pdf', all)!;
    expect(r).toEqual({ avg: 4.8, count: 123 });
    expect(ratingLabel(r)).toBe('4.8 ★ from 123 ratings');
    expect(ratingLabel({ avg: 5, count: 1234 })).toBe('5.0 ★ from 1,234 ratings');
    expect(shownRating('png-to-jpg', all)).toBeNull();
    expect(shownRating('odd', all)).toBeNull();
    expect(shownRating('word-counter', all)).toBeNull();
    expect(aggregateRating(r)).toEqual({ '@type': 'AggregateRating', ratingValue: '4.8', ratingCount: 123, bestRating: 5, worstRating: 1 });
  });

  it('adds aggregateRating to the WebApplication only when there is a rating to show', () => {
    const app = { name: 'Merge PDF', url: 'https://roundertools.com/merge-pdf', description: 'd' };
    expect(webApplication(site, { ...app, rating: shownRating('merge-pdf', all) })).toMatchObject({
      '@type': 'WebApplication',
      offers: { price: '0' },
      aggregateRating: { ratingValue: '4.8', ratingCount: 123 },
    });
    expect(webApplication(site, { ...app, rating: shownRating('png-to-jpg', all) })).not.toHaveProperty('aggregateRating');
    expect(webApplication(site, { ...app, rating: null })).not.toHaveProperty('rating');
  });

  it('ships a well-formed snapshot', () => {
    const file = JSON.parse(readFileSync(new URL('../../src/seo/ratings.json', import.meta.url), 'utf8'));
    expect(normalize(file)).toEqual(file);
  });
});

describe('ratings snapshot script', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
  const root = () => {
    dir = mkdtempSync(join(tmpdir(), 'rounder-ratings-'));
    return pathToFileURL(`${dir}/`);
  };
  const quiet = { info: () => {}, warn: () => {} };
  const file = () => join(dir, 'src/seo/ratings.json');
  const reply = (body: unknown, type = 'application/json', status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

  it('keeps only well-formed aggregates, sorted', () => {
    expect(normalize({ 'word-counter': { avg: 4, count: 2, extra: 1 }, 'merge-pdf': { avg: 5, count: 1 }, bad: { avg: 0, count: 3 }, Bad: { avg: 3, count: 3 }, x: { avg: 3, count: 1.5 } })).toEqual({
      'merge-pdf': { avg: 5, count: 1 },
      'word-counter': { avg: 4, count: 2 },
    });
    expect(() => normalize([])).toThrow();
  });

  it('writes the live aggregates, and keeps the last snapshot when the API is unreachable or not JSON', async () => {
    const url = root();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'src/seo'), { recursive: true });

    await snapshot(url, { fetcher: async () => { throw new Error('offline'); }, log: quiet });
    expect(readFileSync(file(), 'utf8')).toBe('{}\n');

    await snapshot(url, { fetcher: reply({ 'merge-pdf': { avg: 4.5, count: 30 } }), log: quiet });
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ 'merge-pdf': { avg: 4.5, count: 30 } });

    // the static site's 404 page (API not deployed yet), a server error, a timeout: the snapshot stays
    for (const fetcher of [reply('<html>', 'text/html', 404), reply({ error: 'x' }, 'application/json', 500), async () => { throw new Error('timeout'); }]) {
      await snapshot(url, { fetcher, log: quiet });
      expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ 'merge-pdf': { avg: 4.5, count: 30 } });
    }
    writeFileSync(file(), 'kept');
    await snapshot(url, { fetcher: reply([]), log: quiet });
    expect(existsSync(file()) && readFileSync(file(), 'utf8')).toBe('kept');
  });
});

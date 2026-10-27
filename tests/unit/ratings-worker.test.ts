import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { DAILY_CAP, handleApi, ipKey, roundAvg, utcDay, voterId, type D1Like, type D1Statement } from '../../worker/ratings';

// The ratings Worker against real SQLite (Node's built-in), with the real migration, behind the slice of D1's API it uses.
// `latency` makes every query wait like a D1 round trip, so parallel requests interleave between statements.
function d1(latency = 0): D1Like & { sql: DatabaseSync } {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../../migrations/0001_ratings.sql', import.meta.url), 'utf8'));
  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : undefined);
  const statement = (query: string, args: unknown[] = []): D1Statement => {
    const run = () => sql.prepare(query);
    const params = args as (string | number | null)[];
    return {
      bind: (...values) => statement(query, values),
      first: async <T>() => (await wait(), (run().get(...params) as T | undefined) ?? null),
      all: async <T>() => ({ results: run().all(...params) as T[] }),
      run: async () => run().run(...params),
    };
  };
  return { sql, prepare: (query) => statement(query) };
}

const ORIGIN = 'https://roundertools.com';
const known = async (slug: string) => ['merge-pdf', 'png-to-jpg', 'word-counter'].includes(slug);
const day1 = new Date('2026-10-27T12:00:00Z');
const day2 = new Date('2026-10-28T00:30:00Z');

const post = (body: unknown, { ip = '203.0.113.7', origin = ORIGIN, type = 'application/json' } = {}) =>
  new Request(`${ORIGIN}/api/rate`, {
    method: 'POST',
    headers: { origin, 'content-type': type, 'cf-connecting-ip': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const get = (path: string) => new Request(`${ORIGIN}${path}`);
const call = async (db: D1Like, req: Request, now = day1) => {
  const res = await handleApi(req, db, known, now);
  return { status: res.status, body: res.status === 405 ? null : await res.json() };
};

describe('ratings worker', () => {
  it('stores a rating and serves the aggregates', async () => {
    const db = d1();
    expect(await call(db, post({ slug: 'merge-pdf', stars: 5, comment: '  great\n tool ' }))).toEqual({ status: 201, body: { ok: true, replaced: false } });
    await call(db, post({ slug: 'merge-pdf', stars: 4 }, { ip: '198.51.100.1' }));
    await call(db, post({ slug: 'merge-pdf', stars: 4 }, { ip: '198.51.100.2' }));
    await call(db, post({ slug: 'word-counter', stars: 3 }));

    expect(await call(db, get('/api/rating/merge-pdf'))).toEqual({ status: 200, body: { avg: 4.33, count: 3 } });
    expect(await call(db, get('/api/rating/png-to-jpg'))).toEqual({ status: 200, body: { avg: 0, count: 0 } });
    expect((await call(db, get('/api/ratings'))).body).toEqual({ 'merge-pdf': { avg: 4.33, count: 3 }, 'word-counter': { avg: 3, count: 1 } });
    expect(db.sql.prepare('SELECT comment FROM ratings WHERE id = 1').get()).toEqual({ comment: 'great tool' });
    expect(db.sql.prepare('SELECT comment FROM ratings WHERE id = 2').get()).toEqual({ comment: null });
  });

  it('never stores the IP, and forgets the daily hashes once the day is over', async () => {
    const db = d1();
    const ip = '203.0.113.7';
    await call(db, post({ slug: 'merge-pdf', stars: 5 }, { ip }));
    const dump = JSON.stringify(['ratings', 'salts', 'voters'].map((t) => db.sql.prepare(`SELECT * FROM ${t}`).all()));
    expect(dump).not.toContain(ip);
    const { salt } = db.sql.prepare('SELECT salt FROM salts').get() as { salt: string };
    expect(db.sql.prepare('SELECT voter FROM voters').get()).toEqual({ voter: await voterId(salt, ip) });

    // the next day's first write drops yesterday's salt and voters; the rating itself stays, unlinked
    await call(db, post({ slug: 'word-counter', stars: 2 }, { ip: '198.51.100.9' }), day2);
    expect(db.sql.prepare('SELECT day FROM salts').all()).toEqual([{ day: '2026-10-28' }]);
    expect(db.sql.prepare('SELECT day, slug FROM voters').all()).toEqual([{ day: '2026-10-28', slug: 'word-counter' }]);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM ratings').get()).toEqual({ n: 2 });
  });

  it('counts one rating per visitor and tool a day, replacing a second one', async () => {
    const db = d1();
    await call(db, post({ slug: 'merge-pdf', stars: 1 }));
    expect(await call(db, post({ slug: 'merge-pdf', stars: 5, comment: 'works now' }))).toEqual({ status: 200, body: { ok: true, replaced: true } });
    expect((await call(db, get('/api/rating/merge-pdf'))).body).toEqual({ avg: 5, count: 1 });
    expect(db.sql.prepare('SELECT stars, comment FROM ratings').all()).toEqual([{ stars: 5, comment: 'works now' }]);
    // another visitor still counts
    await call(db, post({ slug: 'merge-pdf', stars: 3 }, { ip: '2001:db8::1' }));
    expect((await call(db, get('/api/rating/merge-pdf'))).body).toEqual({ avg: 4, count: 2 });
  });

  it('counts parallel requests from one visitor once', async () => {
    const db = d1(2);
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => handleApi(post({ slug: 'merge-pdf', stars: 1 + (i % 5) }), db, known, day1)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM ratings').get()).toEqual({ n: 1 });
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM voters WHERE rating_id = 0').get()).toEqual({ n: 0 });
  });

  it('treats an IPv6 /64 as one visitor', async () => {
    expect(ipKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:0db8:0001:0002:ffff:1:2:3')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::7')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
    const db = d1();
    await call(db, post({ slug: 'merge-pdf', stars: 1 }, { ip: '2001:db8:1:2::a' }));
    expect((await call(db, post({ slug: 'merge-pdf', stars: 5 }, { ip: '2001:db8:1:2::b' }))).status).toBe(200);
    expect((await call(db, post({ slug: 'merge-pdf', stars: 5 }, { ip: '2001:db8:1:3::a' }))).status).toBe(201);
    expect((await call(db, get('/api/rating/merge-pdf'))).body).toEqual({ avg: 5, count: 2 });
  });

  it('caps how many tools one visitor can rate in a day', async () => {
    const db = d1();
    // the cap counts tools rated today; fake that many by hand, then one more is refused
    await call(db, post({ slug: 'merge-pdf', stars: 4 }));
    const { voter } = db.sql.prepare('SELECT voter FROM voters').get() as { voter: string };
    const add = db.sql.prepare("INSERT INTO voters (day, voter, slug, rating_id) VALUES ('2026-10-27', ?, ?, 1)");
    for (let i = 1; i < DAILY_CAP; i++) add.run(voter, `tool-${i}`);
    expect((await call(db, post({ slug: 'word-counter', stars: 4 }))).status).toBe(429);
    // re-rating a tool already rated today still works, and other visitors are unaffected
    expect((await call(db, post({ slug: 'merge-pdf', stars: 2 }))).status).toBe(200);
    expect((await call(db, post({ slug: 'word-counter', stars: 4 }, { ip: '198.51.100.3' }))).status).toBe(201);
  });

  it('refuses bad requests', async () => {
    const db = d1();
    const status = async (req: Request) => (await call(db, req)).status;
    expect(await status(post({ slug: 'merge-pdf', stars: 5 }, { origin: 'https://evil.example' }))).toBe(403);
    expect(await status(post({ slug: 'merge-pdf', stars: 5 }, { type: 'text/plain' }))).toBe(415);
    expect(await status(post('{nope'))).toBe(400);
    expect(await status(post({ slug: 'merge-pdf', stars: 6 }))).toBe(400);
    expect(await status(post({ slug: 'merge-pdf', stars: 4.5 }))).toBe(400);
    expect(await status(post({ slug: 'merge-pdf', stars: '5' }))).toBe(400);
    expect(await status(post({ slug: 'merge-pdf', stars: 5, comment: 'x'.repeat(281) }))).toBe(400);
    expect(await status(post({ slug: 'merge-pdf', stars: 5, comment: 'x'.repeat(2100) }))).toBe(413);
    expect(await status(post({ slug: 'not-a-tool', stars: 5 }))).toBe(404);
    expect(await status(post({ slug: '../etc', stars: 5 }))).toBe(400);
    expect(db.sql.prepare('SELECT COUNT(*) AS n FROM ratings').get()).toEqual({ n: 0 });
  });

  it('routes only its own endpoints and methods', async () => {
    const db = d1();
    expect((await call(db, get('/api/rate'))).status).toBe(405);
    expect((await call(db, new Request(`${ORIGIN}/api/ratings`, { method: 'POST' }))).status).toBe(405);
    expect((await call(db, get('/api/rating/BAD_slug'))).status).toBe(404);
    expect((await call(db, get('/api/other'))).status).toBe(404);
    const res = await handleApi(get('/api/ratings'), db, known, day1);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('days and averages', async () => {
    expect(utcDay(new Date('2026-10-27T23:59:59-05:00'))).toBe('2026-10-28');
    expect(roundAvg(4.666666)).toBe(4.67);
    expect(roundAvg(null)).toBe(0);
    expect(await voterId('a', '1.2.3.4')).not.toBe(await voterId('b', '1.2.3.4'));
    expect(await voterId('a', '1.2.3.4')).toMatch(/^[0-9a-f]{64}$/);
  });
});

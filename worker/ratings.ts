// The ratings API behind "Rate this tool". Everything here takes its database and clock as arguments, so the tests run
// it against SQLite (tests/unit/ratings-worker.test.ts) without a Workers runtime.
//
//   POST /api/rate          { slug, stars: 1–5, comment?: ≤280 chars }  → 201 { ok } (200 when it replaced today's rating)
//   GET  /api/rating/:slug  → { avg, count }
//   GET  /api/ratings       → { [slug]: { avg, count } }, read at build time by scripts/seo/ratings.mjs
//
// Privacy: no IP is stored. Rate limiting keys on SHA-256(today's random salt + IP, or its IPv6 /64); the salt and hashes are
// deleted after the UTC day ends (on the next write and by the daily cron), so a rating can't be traced back afterwards.
import { parseRating, SLUG_RE } from '../src/tools/lib/rating';

/** the slice of Cloudflare's D1 API used here */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
}

export interface Rating {
  avg: number;
  count: number;
}

/** ratings one visitor (IP) can leave per UTC day, across all tools */
export const DAILY_CAP = 40;
export const MAX_BODY = 2048;

export const utcDay = (now: Date) => now.toISOString().slice(0, 10);
export const roundAvg = (avg: number | null) => Math.round((avg ?? 0) * 100) / 100;

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** the daily voter id: a salted hash, so the same IP gives the same id today and an unrelated one tomorrow */
export const voterId = async (salt: string, ip: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${ip}`)));

/** who counts as one visitor: an IPv4 address, or an IPv6 address's /64, since one phone or home gets a whole /64 and
 *  can switch addresses inside it at will */
export function ipKey(ip: string) {
  const v4 = ip.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.toLowerCase().split('::');
  const part = (s?: string) => (s ? s.split(':') : []);
  const groups = tail === undefined ? part(head) : [...part(head), ...Array(8 - part(head).length - part(tail).length).fill('0'), ...part(tail)];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export const json = (data: unknown, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'x-content-type-options': 'nosniff' },
  });

/** browsers always send Origin on a POST from fetch(); other sites' pages can't post ratings for our visitors */
export const sameOrigin = (request: Request) => request.headers.get('origin') === new URL(request.url).origin;

async function saltFor(db: D1Like, day: string) {
  const fresh = hex(crypto.getRandomValues(new Uint8Array(16)));
  await db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, fresh).run();
  return (await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first<{ salt: string }>())!.salt;
}

/** drops every salt and voter hash from before `day` */
export async function forgetOldVoters(db: D1Like, day: string) {
  await db.prepare('DELETE FROM voters WHERE day < ?').bind(day).run();
  await db.prepare('DELETE FROM salts WHERE day < ?').bind(day).run();
}

export async function rate(request: Request, db: D1Like, known: (slug: string) => Promise<boolean>, now: Date) {
  if (!sameOrigin(request)) return json({ error: 'Ratings can only be sent from roundertools.com.' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Send JSON.' }, 415);
  // refused before reading, so a huge body never fills the isolate's memory
  if (Number(request.headers.get('content-length')) > MAX_BODY) return json({ error: 'Too long.' }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too long.' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Expected JSON.' }, 400);
  }
  const parsed = parseRating(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { slug, stars, comment } = parsed.value;
  if (!(await known(slug))) return json({ error: 'Unknown tool.' }, 404);

  const day = utcDay(now);
  await forgetOldVoters(db, day);
  const voter = await voterId(await saltFor(db, day), ipKey(request.headers.get('cf-connecting-ip') ?? ''));
  const key = [day, voter, slug];

  // claim this visitor's slot for the tool in one statement before any rating is written, so parallel requests can't
  // each slip a rating in; rating_id 0 marks a claim whose rating isn't saved yet
  const claimed = await db
    .prepare('INSERT INTO voters (day, voter, slug, rating_id) VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING RETURNING slug')
    .bind(...key)
    .first();
  if (!claimed) {
    // a second rating of the same tool on the same day replaces the first, so one visitor counts once
    const prev = await db.prepare('SELECT rating_id FROM voters WHERE day = ? AND voter = ? AND slug = ?').bind(...key).first<{ rating_id: number }>();
    if (!prev?.rating_id) return json({ error: 'Your last rating is still being saved. Try again in a moment.' }, 409);
    await db.prepare('UPDATE ratings SET stars = ?, comment = ? WHERE id = ?').bind(stars, comment || null, prev.rating_id).run();
    return json({ ok: true, replaced: true });
  }
  const unclaim = () => db.prepare('DELETE FROM voters WHERE day = ? AND voter = ? AND slug = ?').bind(...key).run();
  const used = await db.prepare('SELECT COUNT(*) AS n FROM voters WHERE day = ? AND voter = ?').bind(day, voter).first<{ n: number }>();
  if ((used?.n ?? 0) > DAILY_CAP) {
    await unclaim();
    return json({ error: "That's a lot of ratings for one day. Try again tomorrow." }, 429);
  }
  try {
    const row = await db
      .prepare('INSERT INTO ratings (slug, stars, comment, day) VALUES (?, ?, ?, ?) RETURNING id')
      .bind(slug, stars, comment || null, day)
      .first<{ id: number }>();
    await db.prepare('UPDATE voters SET rating_id = ? WHERE day = ? AND voter = ? AND slug = ?').bind(row!.id, ...key).run();
  } catch (err) {
    await unclaim();
    throw err;
  }
  return json({ ok: true, replaced: false }, 201);
}

export async function ratingOf(db: D1Like, slug: string): Promise<Rating> {
  const row = await db.prepare('SELECT COUNT(*) AS count, AVG(stars) AS avg FROM ratings WHERE slug = ?').bind(slug).first<{ count: number; avg: number | null }>();
  return { avg: roundAvg(row?.avg ?? null), count: row?.count ?? 0 };
}

export async function allRatings(db: D1Like): Promise<Record<string, Rating>> {
  const { results } = await db
    .prepare('SELECT slug, COUNT(*) AS count, AVG(stars) AS avg FROM ratings GROUP BY slug ORDER BY slug')
    .all<{ slug: string; count: number; avg: number }>();
  return Object.fromEntries(results.map((r) => [r.slug, { avg: roundAvg(r.avg), count: r.count }]));
}

// aggregates are public and change slowly; a short cache keeps repeat reads off the database
const PUBLIC = 'public, max-age=300';

/** every /api/* request (wrangler.jsonc sends only those to the Worker first) */
export async function handleApi(request: Request, db: D1Like, known: (slug: string) => Promise<boolean>, now = new Date()) {
  const { pathname } = new URL(request.url);
  const get = request.method === 'GET' || request.method === 'HEAD';
  const notAllowed = (allow: string) => new Response(null, { status: 405, headers: { allow } });

  if (pathname === '/api/rate') return request.method === 'POST' ? rate(request, db, known, now) : notAllowed('POST');
  if (pathname === '/api/ratings') return get ? json(await allRatings(db), 200, PUBLIC) : notAllowed('GET, HEAD');
  const one = pathname.match(/^\/api\/rating\/([^/]+)$/);
  if (one && SLUG_RE.test(one[1])) return get ? json(await ratingOf(db, one[1]), 200, PUBLIC) : notAllowed('GET, HEAD');
  return json({ error: 'Not found.' }, 404);
}

// Snapshots the live "Rate this tool" aggregates into src/seo/ratings.json before every build (npm prebuild), so tool
// pages can show them and, from MIN_RATINGS on, mark them up (src/seo/ratings.ts). Fail-soft: offline, or while the API
// isn't deployed, the previous snapshot stays as it is and the build goes on.
//   RATINGS_API=<url> to read another deployment, RATINGS_OFFLINE=1 to skip the fetch.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SNAPSHOT = 'src/seo/ratings.json';
const API = process.env.RATINGS_API || 'https://roundertools.com/api/ratings';

/** keeps only well-formed entries ({ avg 1–5, whole count ≥ 1 } under a slug), sorted by slug */
export function normalize(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
  const ok = ([slug, r]) =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && r && Number.isInteger(r.count) && r.count >= 1 && Number.isFinite(r.avg) && r.avg >= 1 && r.avg <= 5;
  return Object.fromEntries(
    Object.entries(data).filter(ok).sort(([a], [b]) => a.localeCompare(b)).map(([slug, r]) => [slug, { avg: r.avg, count: r.count }]),
  );
}

/**
 * @param {URL} root the repo root (a directory URL)
 * @param {{ fetcher?: (url: string, init: RequestInit) => Promise<Response>, log?: Pick<Console, 'info' | 'warn'> }} [options]
 */
export async function snapshot(root, { fetcher = fetch, log = console } = {}) {
  const file = new URL(SNAPSHOT, root);
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (prev === null) writeFileSync(file, '{}\n');
  if (process.env.RATINGS_OFFLINE) return log.info('ratings: RATINGS_OFFLINE is set, keeping the last snapshot');
  try {
    const res = await fetcher(API, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) throw new Error(`HTTP ${res.status}`);
    const next = `${JSON.stringify(normalize(await res.json()), null, 2)}\n`;
    if (next !== prev) writeFileSync(file, next);
    log.info(`ratings: ${Object.keys(JSON.parse(next)).length} tools rated (${API})`);
  } catch (err) {
    log.warn(`ratings: couldn't read ${API} (${err.message}); keeping the last snapshot`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await snapshot(new URL('../../', import.meta.url));

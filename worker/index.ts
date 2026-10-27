// The site's only server code: the ratings API (worker/ratings.ts). wrangler.jsonc runs this Worker first for /api/*
// only. Every other request is served from the static assets without it, except one that matches no file and isn't a
// page navigation (a missing image, say), which lands here and goes straight back to the assets for their 404 page.
import { forgetOldVoters, handleApi, json, utcDay, type D1Like } from './ratings';

interface Env {
  DB: D1Like;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// the deployed tool slugs, read once per isolate from the build's own search index, so the API accepts exactly the
// tools that exist on the site
let slugs: Promise<Set<string>> | undefined;
const knownTools = (env: Env, origin: string) => async (slug: string) => {
  const list = (slugs ??= env.ASSETS.fetch(new Request(new URL('/search-index.json', origin)))
    .then((r) => (r.ok ? (r.json() as Promise<{ slug: string }[]>) : Promise.reject(new Error(`search index ${r.status}`))))
    .then((tools) => new Set(tools.map((t) => t.slug))));
  try {
    return (await list).has(slug);
  } catch (err) {
    if (slugs === list) slugs = undefined; // try again on the next request
    throw err;
  }
};

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env.DB, knownTools(env, url.origin));
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong. Please try again later.' }, 500);
    }
  },

  /** daily cron (wrangler.jsonc): yesterday's salt and voter hashes go even on days nobody rates */
  async scheduled(_event: unknown, env: Env) {
    await forgetOldVoters(env.DB, utcDay(new Date()));
  },
};

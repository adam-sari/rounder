import snapshot from './ratings.json';

// Visitor ratings from "Rate this tool", as snapshotted at build time by scripts/seo/ratings.mjs from the live API
// (worker/ratings.ts). Only real ratings from visitors, never seeded, edited or hard-coded.
//
// Google's rules: review stars for software come from aggregateRating on a SoftwareApplication (WebApplication is a
// subtype), https://developers.google.com/search/docs/appearance/structured-data/software-app. The rating must be
// "sourced directly from users" and visible on the page, and fake or undisclosed incentivized reviews are banned,
// https://developers.google.com/search/docs/appearance/structured-data/review-snippet. Ratings of the site itself on
// Organization/LocalBusiness ("self-serving") aren't eligible, so ratings only ever go on a tool's WebApplication.

export interface Rating {
  avg: number;
  count: number;
}

/** below this many ratings a tool shows no stars at all, on the page or in its markup */
export const MIN_RATINGS = 20;

const ratings = snapshot as Record<string, Rating>;

/** a tool's rating, rounded to one decimal, once it has MIN_RATINGS; the page shows exactly what the markup says */
export function shownRating(slug: string, all: Record<string, Rating> = ratings): Rating | null {
  const r = all[slug];
  if (!r || !Number.isInteger(r.count) || r.count < MIN_RATINGS || !(r.avg >= 1 && r.avg <= 5)) return null;
  return { avg: Math.round(r.avg * 10) / 10, count: r.count };
}

export const ratingLabel = (r: Rating) => `${r.avg.toFixed(1)} ★ from ${r.count.toLocaleString('en-US')} ratings`;

export const aggregateRating = (r: Rating) => ({
  '@type': 'AggregateRating',
  ratingValue: r.avg.toFixed(1),
  ratingCount: r.count,
  bestRating: 5,
  worstRating: 1,
});

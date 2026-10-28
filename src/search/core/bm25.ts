// BM25 over weighted tool fields, with typo tolerance against the index's own vocabulary. Built in the browser from
// the lean index in a few milliseconds, so no postings ship.
import { lexTokens, osa } from './text';
import type { SearchDoc } from './types';

const FIELDS: [keyof SearchDoc | 'slugWords', number][] = [
  ['name', 3],
  ['slugWords', 2],
  ['keywords', 2],
  ['tagline', 1],
  ['description', 0.6],
];

export interface Bm25 {
  search(q: string): { slug: string; s: number }[];
  /** the query's tokens after typo fixing, as the index reads them */
  terms(q: string): string[];
  /** every token a tool's text contains (for "does the best match cover the query?") */
  tokens(slug: string): Set<string>;
}

export function buildBm25(docs: SearchDoc[]): Bm25 {
  const K1 = 1.2;
  const B = 0.5;
  const rows = docs.map((d) => {
    const tf = new Map<string, number>();
    let len = 0;
    for (const [f, w] of FIELDS) {
      const v = f === 'slugWords' ? d.slug.replace(/-/g, ' ') : d[f];
      const text = Array.isArray(v) ? v.join(' . ') : typeof v === 'string' ? v : '';
      for (const t of lexTokens(text)) {
        tf.set(t, (tf.get(t) ?? 0) + w);
        len += w;
      }
    }
    return { slug: d.slug, tf, len };
  });
  const avg = rows.reduce((a, r) => a + r.len, 0) / (rows.length || 1);
  const df = new Map<string, number>();
  for (const r of rows) for (const t of r.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const vocab = [...df.keys()];
  const N = rows.length;
  const fixes = new Map<string, string>();

  /** an unknown word → the closest index word within 1 edit (2 for long words), the more common one on a tie */
  function fix(w: string): string {
    if (df.has(w) || w.length < 4 || /\d/.test(w)) return w;
    const hit = fixes.get(w);
    if (hit) return hit;
    const max = w.length >= 7 ? 2 : 1;
    let best = w;
    let bd = max + 1;
    let bdf = 0;
    for (const v of vocab) {
      if (Math.abs(v.length - w.length) > max) continue;
      const d = osa(w, v, max);
      if (d < bd || (d === bd && df.get(v)! > bdf)) [best, bd, bdf] = [v, d, df.get(v)!];
    }
    const out = bd <= max ? best : w;
    fixes.set(w, out);
    return out;
  }

  const terms = (q: string) => [...new Set(lexTokens(q).map(fix))];
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  return {
    terms,
    tokens: (slug) => new Set(bySlug.get(slug)?.tf.keys() ?? []),
    search(q) {
      const ts = terms(q).filter((t) => df.has(t));
      if (!ts.length) return [];
      const out: { slug: string; s: number }[] = [];
      for (const r of rows) {
        let s = 0;
        for (const t of ts) {
          const f = r.tf.get(t);
          if (!f) continue;
          const n = df.get(t)!;
          s += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * r.len) / avg)));
        }
        if (s > 0) out.push({ slug: r.slug, s });
      }
      return out.sort((a, b) => b.s - a.s);
    },
  };
}

// The hybrid search: parser routes, BM25 and (once loaded) static embeddings, fused into one ranked list with a
// one-line why for the best match. Parser routes are strong boosts, never pins, so the other layers can outvote a
// wrong rule. Pure: runs the same in the browser, in Node tests and in the build.
import { buildBm25 } from './bm25';
import { presetHash } from './hash';
import { FORMATS, KINDS, UNSUPPORTED } from './lexicon';
import { compatible, formatOf, makeCatalog, plan, type Catalog } from './route';
import { lexTokens } from './text';
import type { Hit, Route, SearchDoc, SearchResult } from './types';

/** words that only name a kind of file: every video tool "covers" the query "video converter" */
const GENERIC = new Set(lexTokens([...Object.values(FORMATS).flatMap((f) => f.aliases), ...Object.values(KINDS).flat()].join(' ')));

/** a semantic scorer: cosine similarity of the query to every tool, in catalog order */
export interface Semantic {
  scores(q: string): Float32Array;
}

/** fusion weights; tuned on the dev set only (tests/fixtures/search/eval.json) */
export const WEIGHTS = { lex: 0.55, emb: 0.45, exact: 1.5, rule: 1.0, weak: 0.6, chain: 1.0, reverse: 1.5, incompatible: 0.35 };


export interface Engine {
  catalog: Catalog;
  search(q: string, opts?: { semantic?: Semantic | null; limit?: number }): SearchResult;
}

export function createEngine(docs: SearchDoc[]): Engine {
  const catalog = makeCatalog(docs);
  const bm = buildBm25(docs);
  const index = new Map(docs.map((d, i) => [d.slug, i]));

  function hit(slug: string, score: number, source: Hit['source'], r?: Route): Hit {
    const d = catalog.bySlug.get(slug)!;
    // only presets the page will actually read go into the link
    const preset = Object.fromEntries(Object.entries(r?.preset ?? {}).filter(([k]) => d.presets?.includes(k)));
    // the why-line sits beside the name, so "Compress PDF · 25 MB for Gmail" shows as its detail; no detail, the tagline
    const detail = r?.why.includes(' · ') ? r.why.slice(r.why.indexOf(' · ') + 3) : r?.why && r.why !== d.name ? r.why : '';
    return { slug, name: d.name, kind: d.kind, why: detail || d.tagline, preset, href: `/${slug}${presetHash(preset)}`, score, source };
  }

  function search(q: string, { semantic = null, limit = 8 }: { semantic?: Semantic | null; limit?: number } = {}): SearchResult {
    const query = q.trim();
    const empty: SearchResult = { query, hits: [], confident: false, chain: [], wantsSemantic: false, hinglish: false };
    if (!query) return empty;
    const p = plan(catalog, query);
    const e = p.entities;
    const lex = bm.search(query);
    const W = WEIGHTS;
    const score = new Float64Array(docs.length);
    const maxL = lex[0]?.s || 1;
    for (const r of lex) score[index.get(r.slug)!] += (semantic ? W.lex : 1) * (r.s / maxL);

    if (semantic) {
      const cos = semantic.scores(query);
      const order = [...cos].sort((a, b) => b - a);
      const [maxE, minE] = [order[0], order[Math.min(40, order.length - 1)]];
      for (let i = 0; i < docs.length; i++) score[i] += W.emb * Math.max(0, (cos[i] - minE) / (maxE - minE || 1));
    }

    const routeOf = new Map<string, Route>();
    for (const r of p.routes) {
      const i = index.get(r.slug);
      if (i === undefined) continue;
      routeOf.set(r.slug, r);
      score[i] += r.tier === 'exact' ? W.exact : r.tier === 'rule' ? W.rule : W.weak * r.conf;
    }
    if (p.chain.length) {
      const i = index.get(p.chain[0].slug);
      if (i !== undefined) score[i] += W.chain;
    }

    // never offer the reverse conversion ("png to gif" → gif-to-png), and push tools for another kind of file down
    for (let i = 0; i < docs.length; i++) {
      if (!score[i]) continue;
      const slug = docs[i].slug;
      const m = /^([a-z0-9]+)-to-([a-z0-9]+)$/.exec(slug);
      const to = e.to ?? e.toKind;
      if (m && e.from && to && formatOf(m[1]) === to && formatOf(m[2]) === e.from) score[i] -= W.reverse;
      if (!routeOf.has(slug) && !compatible(catalog, slug, e)) score[i] -= W.incompatible;
    }

    const ranked = [...score.keys()].filter((i) => score[i] > 0).sort((a, b) => score[b] - score[a]).slice(0, limit);
    const hits = ranked.map((i) => {
      const slug = docs[i].slug;
      const r = routeOf.get(slug);
      return hit(slug, score[i], r ? 'parser' : lex.some((x) => x.slug === slug) ? 'lexical' : 'semantic', r);
    });

    const unsupported = UNSUPPORTED.find((u) => u.re.test(e.text));
    const note = unsupported?.say ?? p.note;
    const top = hits[0];
    let confident = false;
    if (top && !note && compatible(catalog, top.slug, e)) {
      const r = routeOf.get(top.slug);
      const terms = bm.terms(query);
      const toks = bm.tokens(top.slug);
      const coverage = terms.some((t) => !GENERIC.has(t)) ? terms.filter((t) => toks.has(t)).length / terms.length : 0;
      // the model re-ranks but never decides "Best match": its cosines don't separate tools from out-of-scope asks
      confident = (!!r && r.conf >= 0.8) || coverage >= 0.7;
    }

    const chain = p.chain.length >= 2 ? p.chain.filter((r) => catalog.bySlug.has(r.slug)).map((r) => hit(r.slug, 0, 'parser', r)) : [];
    return { query, hits, confident, chain, note, wantsSemantic: !p.routes.some((r) => r.tier === 'exact'), hinglish: e.hinglish };
  }

  return { catalog, search };
}

// Shared by the search eval tests and scripts/search/eval: fixtures, the engine over the live registry, scoring.
import { readFileSync } from 'node:fs';
import { tools } from '@/tools/registry';
import { toSearchDoc } from '@/search/docs';
import { createEngine, type Semantic } from '@/search/core/search';
import { toolVectors, vendoredModel } from '@/search/build';
import { decodeVectors } from '@/search/semantic/vectors';

export interface Query {
  q: string;
  c: string;
  accept: string[];
  preset?: Record<string, unknown>;
  chain?: string[];
}

export const load = (name: string): Query[] => JSON.parse(readFileSync(`tests/fixtures/search/${name}.json`, 'utf8')).queries;
export const docs = tools.map(toSearchDoc);
export const engine = createEngine(docs);

export interface Score {
  n: number;
  hit1: number;
  hit3: number;
  /** "Best match" shown and wrong */
  confidentWrong: number;
  perClass: Record<string, { n: number; hit1: number }>;
  misses: string[];
}

export function score(set: Query[], semantic: Semantic | null = null): Score {
  const scored = set.filter((x) => x.accept.length);
  const s: Score = { n: scored.length, hit1: 0, hit3: 0, confidentWrong: 0, perClass: {}, misses: [] };
  for (const x of scored) {
    const r = engine.search(x.q, { semantic });
    const rank = r.hits.findIndex((h) => x.accept.includes(h.slug));
    const c = (s.perClass[x.c] ??= { n: 0, hit1: 0 });
    c.n++;
    if (rank === 0) [s.hit1, c.hit1] = [s.hit1 + 1, c.hit1 + 1];
    else s.misses.push(`${r.confident ? '!' : ' '} ${x.q} → ${r.hits.slice(0, 3).map((h) => h.slug).join(', ') || '∅'}`);
    if (rank >= 0 && rank < 3) s.hit3++;
    if (rank !== 0 && r.confident) s.confidentWrong++;
  }
  return s;
}

export const pct = (a: number, n: number) => Math.round((1000 * a) / n) / 10;

/** the shipped semantic layer: the vendored model and tool vectors built exactly as the site build does */
export function loadSemantic(): Semantic {
  const model = vendoredModel();
  const bytes = toolVectors(model);
  const vectors = decodeVectors(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return { scores: (q) => vectors.scores(model.embed(q)) };
}

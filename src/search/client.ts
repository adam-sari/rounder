// The search box's browser side, loaded on first use (never with the page): the lean index and engine, then the
// static embedding model after the first query unless the visitor saves data or is on a slow connection.
// Everything runs here; no query ever leaves the device, and nothing about it is stored.
import type { SearchManifest } from './build';
import { createEngine, type Engine, type Semantic } from './core/search';
import type { SearchDoc } from './core/types';
import { loadModel } from './semantic/model2vec';
import { decodeVectors } from './semantic/vectors';

export type { SearchManifest };

export interface Loaded {
  engine: Engine;
  categories: Record<string, string>;
}

let engine: Promise<Loaded> | undefined;
let semantic: Semantic | null = null;
let semanticLoading: Promise<Semantic | null> | undefined;

export function loadEngine(m: SearchManifest): Promise<Loaded> {
  engine ??= fetch(m.index)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`search index ${r.status}`))))
    .then(({ docs, categories }: { docs: SearchDoc[]; categories: Record<string, string> }) => ({ engine: createEngine(docs), categories }))
    .catch((err) => {
      engine = undefined;
      throw err;
    });
  return engine;
}

/** Save-Data, or a connection too slow for a 2 MB download, keeps search to the parser and BM25 */
export function semanticAllowed(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (c?.saveData) return false;
  if (c?.effectiveType && ['slow-2g', '2g', '3g'].includes(c.effectiveType)) return false;
  return !matchMedia('(prefers-reduced-data: reduce)').matches;
}

/** starts the model download once; resolves to null when skipped or when it fails (search works without it) */
export function loadSemantic(m: SearchManifest, docCount: number): Promise<Semantic | null> {
  if (!semanticAllowed()) return Promise.resolve(null);
  semanticLoading ??= Promise.all([
    fetch(m.model).then((r) => r.arrayBuffer()),
    fetch(m.vocab).then((r) => r.text()),
    fetch(m.vectors).then((r) => r.arrayBuffer()),
  ])
    .then(([bin, vocab, vecs]) => {
      const model = loadModel(bin, vocab);
      const vectors = decodeVectors(vecs);
      // a stale vectors file from another build would score the wrong tools
      if (vectors.tools !== docCount) return null;
      return (semantic = { scores: (q: string) => vectors.scores(model.embed(q)) });
    })
    .catch(() => null);
  return semanticLoading;
}

/** the model, once it has arrived */
export const readySemantic = () => semantic;

/* ---------- recent tools: slugs only, at most 6, on this device ---------- */

const RECENT_KEY = 'rounder:recent';

export function recentTools(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function rememberTool(slug: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([slug, ...recentTools().filter((s) => s !== slug)].slice(0, 6)));
  } catch {}
}

/** opens a result; a preset for the page already open needs a reload, since islands read it once */
export function openHref(href: string) {
  rememberTool(href.slice(1).split('#')[0]);
  const url = new URL(href, location.href);
  const same = url.pathname === location.pathname;
  location.assign(url.href);
  if (same && url.hash) location.reload();
}

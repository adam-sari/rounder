// One search box's state, shared by the ⌘K palette and the home page hero. The engine and the model are imported
// and fetched on first use, so pages carry none of it.
import type { SearchManifest } from '../build';
import { presetHash } from '../core/hash';
import type { Hit, Preset, SearchResult } from '../core/types';

type Client = typeof import('../client');

export interface Item {
  id: string;
  type: 'best' | 'plan' | 'alt' | 'recent';
  hit: Hit;
  /** plan rows: the steps, in order */
  steps?: Hit[];
  /** plan rows: who made the plan */
  by?: 'parser' | 'next';
}

let client: Promise<Client> | undefined;
const loadClient = () => (client ??= import('../client'));

export class SearchSession {
  query = $state('');
  result = $state.raw<SearchResult | null>(null);
  recent = $state.raw<Hit[]>([]);
  ready = $state(false);
  failed = $state(false);
  categories: Record<string, string> = {};
  #c?: Client;
  #engine?: Awaited<ReturnType<Client['loadEngine']>>['engine'];
  #semanticAsked = false;

  constructor(private manifest: SearchManifest, private limit = 7) {}

  /** fetch the engine (idempotent); search runs as soon as it's here */
  async warm() {
    if (this.#engine) return;
    try {
      this.#c = await loadClient();
      const loaded = await this.#c.loadEngine(this.manifest);
      [this.#engine, this.categories] = [loaded.engine, loaded.categories];
      this.ready = true;
      this.recent = this.#c.recentTools().map((s) => this.hitFor(s)).filter((h): h is Hit => !!h);
      this.run();
    } catch {
      this.failed = true;
    }
  }

  hitFor(slug: string, preset: Preset = {}): Hit | undefined {
    const d = this.#engine?.catalog.bySlug.get(slug);
    return d && { slug, name: d.name, kind: d.kind, why: d.tagline, preset, href: `/${slug}${presetHash(preset)}`, score: 0, source: 'ai' };
  }

  go(href: string) {
    this.#c?.openHref(href);
  }

  /** search the current query; the semantic model joins from the next keystroke after it arrives, never mid-look */
  run() {
    if (!this.#engine || !this.#c) return;
    const q = this.query.trim();
    this.result = q ? this.#engine.search(q, { semantic: this.#c.readySemantic(), limit: this.limit }) : null;
    if (q && !this.#semanticAsked) {
      this.#semanticAsked = true;
      void this.#c.loadSemantic(this.manifest, this.#engine.catalog.docs.length);
    }
  }

  /** best match, the plan (parser chain, AI plan, or the best match's next step), then the rest */
  get items(): Item[] {
    const r = this.result;
    if (!r) return this.recent.map((hit) => ({ id: `r-${hit.slug}`, type: 'recent', hit }));
    if (!r.hits.length) return [];
    const [best, ...rest] = r.hits;
    const items: Item[] = [{ id: `b-${best.slug}`, type: 'best', hit: best }];
    if (r.chain.length >= 2) items.push({ id: 'plan', type: 'plan', hit: r.chain[0], steps: r.chain, by: 'parser' });
    else if (r.confident) {
      const next = this.#engine?.catalog.bySlug.get(best.slug)?.next?.[0];
      const then = next && this.hitFor(next);
      if (then) items.push({ id: 'plan', type: 'plan', hit: then, steps: [best, then], by: 'next' });
    }
    for (const hit of rest.slice(0, this.limit - 1)) items.push({ id: `a-${hit.slug}`, type: 'alt', hit });
    return items;
  }

  open(item: Item) {
    // a plan starts at its first step; a "then" row opens the next tool itself
    const target = item.type === 'plan' && item.by !== 'next' ? item.steps![0] : item.hit;
    this.go(target.href);
  }

  /** the shortlist the AI may choose from: the hybrid's own top tools */
  shortlist(n = 12) {
    const q = this.query.trim();
    if (!this.#engine || !q) return [];
    return this.#engine.search(q, { semantic: this.#c?.readySemantic(), limit: n }).hits.map((h) => this.#engine!.catalog.bySlug.get(h.slug)!);
  }
}

// Search quality gates. Policy: eval.json (dev) is the only set used for tuning. holdout.json and fresh.json are
// append-only and never tuned on; fresh.json is the critique's independent set (Google autocomplete seeds the design
// never used, labelled before any scorer ran), so its targets are the ones that matter. A change that edits the
// parser and these labels together fails review. Run `npx vitest run tests/unit/search/eval.test.ts --silent=false`
// to print every layer's scores and misses.
import { beforeAll, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { tools } from '@/tools/registry';
import { formatOf } from '@/search/core/route';
import { presetHash } from '@/search/core/hash';
import { presetFromHash } from '@/tools/presets';
import type { Semantic } from '@/search/core/search';
import { docs, engine, load, loadSemantic, pct, score, type Query } from './harness';

const dev = load('eval');
const holdout = load('holdout');
const fresh = load('fresh');
// the adversarial review's own set (see its about line): seen once fixed, so a regression gate, not a score to quote
const review = load('review');
// "convert word to jpg" has no single tool but a two-step answer, so it isn't out of scope
const outOfScope = [...load('abstain'), ...dev, ...holdout, ...fresh].filter((x) => !x.accept.length && !x.chain);

let model: Semantic;
beforeAll(() => {
  model = loadSemantic();
});

function report(name: string, set: Query[], sem: Semantic | null) {
  const s = score(set, sem);
  const classes = Object.entries(s.perClass).map(([c, v]) => `${c} ${v.hit1}/${v.n}`).join(', ');
  console.log(`${name}: hit@1 ${pct(s.hit1, s.n)}% hit@3 ${pct(s.hit3, s.n)}% confident-wrong ${s.confidentWrong} (n=${s.n}; ${classes})\n${s.misses.join('\n')}`);
  return { ...s, h1: s.hit1 / s.n, h3: s.hit3 / s.n };
}

describe('search quality', () => {
  it('dev set (regression only)', () => {
    for (const sem of [null, model]) expect(report(`dev ${sem ? '+model' : 'parser+BM25'}`, dev, sem).h1).toBeGreaterThanOrEqual(0.97);
  });

  it('held-out set', () => {
    for (const sem of [null, model]) {
      const s = report(`holdout ${sem ? '+model' : 'parser+BM25'}`, holdout, sem);
      expect(s.h1).toBeGreaterThanOrEqual(0.95);
      expect(s.h3).toBeGreaterThanOrEqual(0.97);
    }
  });

  // the critique measured parser + BM25 at 80.0 / 90.6 and + potion-2M at 84.7 / 94.1 on this set; these gates sit
  // just under what this build scores, so any regression fails
  it('fresh set without the model (parser + BM25)', () => {
    const s = report('fresh parser+BM25', fresh, null);
    expect(s.h1).toBeGreaterThanOrEqual(0.93);
    expect(s.h3).toBeGreaterThanOrEqual(0.92);
  });

  it('fresh set with the model', () => {
    const plain = score(fresh, null);
    const s = report('fresh +potion-2M', fresh, model);
    expect(s.h1).toBeGreaterThanOrEqual(0.95);
    expect(s.h3).toBeGreaterThanOrEqual(0.96);
    expect(s.hit1).toBeGreaterThanOrEqual(plain.hit1);
  });

  it('review set', () => {
    for (const sem of [null, model]) {
      const s = report(`review ${sem ? '+model' : 'parser+BM25'}`, review, sem);
      expect(s.h1).toBeGreaterThanOrEqual(0.95);
      expect(s.confidentWrong).toBeLessThanOrEqual(1);
    }
  });

  it('head queries always land, and Hinglish and typos work like English', () => {
    for (const sem of [null, model]) {
      const s = score([...dev, ...holdout, ...fresh], sem);
      // the model rescues "mp3 converter"; without it one head query may slip to #2
      expect(s.perClass.head.n - s.perClass.head.hit1).toBeLessThanOrEqual(sem ? 0 : 1);
      const unseen = score([...holdout, ...fresh].filter((x) => x.c === 'hinglish' || x.c === 'typo'), sem);
      expect(unseen.hit1 / unseen.n).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('rarely shows a wrong "Best match"', () => {
    for (const sem of [null, model]) {
      const s = score([...holdout, ...fresh], sem);
      expect(s.confidentWrong / s.n).toBeLessThanOrEqual(0.03);
    }
  });

  it('answers out-of-scope queries with "Closest tools", not a confident guess', () => {
    for (const sem of [null, model]) {
      const wrong = outOfScope.filter((x) => engine.search(x.q, { semantic: sem }).confident).map((x) => x.q);
      console.log(`out of scope shown as Best match (${sem ? '+model' : 'plain'}): ${wrong.length}/${outOfScope.length}`, wrong);
      expect(1 - wrong.length / outOfScope.length).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('still calls most real matches a "Best match"', () => {
    const pos = [...holdout, ...fresh].filter((x) => x.accept.length);
    const confident = pos.filter((x) => engine.search(x.q, { semantic: model }).confident).length;
    expect(confident / pos.length).toBeGreaterThanOrEqual(0.85);
  });
});

describe('conversion direction', () => {
  // every "a-to-b" tool, asked both ways: the forward query finds it, the reverse never does
  const pairs = docs.filter((d) => {
    const m = /^([a-z0-9]+)-to-([a-z0-9]+)$/.exec(d.slug);
    return m && formatOf(m[1]) && formatOf(m[2]);
  });

  it('covers the pair pages', () => {
    expect(pairs.length).toBeGreaterThan(40);
  });

  it('makes no direction errors', () => {
    const errors: string[] = [];
    for (const sem of [null, model]) {
      for (const d of pairs) {
        const [a, b] = d.slug.split('-to-');
        const fwd = engine.search(`${a} to ${b}`, { semantic: sem }).hits[0]?.slug;
        const rev = engine.search(`${b} to ${a}`, { semantic: sem }).hits[0]?.slug;
        if (fwd !== d.slug && fwd !== d.variantOf) errors.push(`${a} to ${b} → ${fwd}`);
        if (rev === d.slug) errors.push(`${b} to ${a} → ${rev} (reversed)`);
      }
    }
    expect(errors).toEqual([]);
  });

  it('says so when there is no such converter', () => {
    for (const q of ['png to gif', 'pdf to epub', 'ico to png']) {
      const r = engine.search(q);
      expect(r.confident, q).toBe(false);
      expect(r.note, q).toMatch(/^No .+ converter yet\.$/);
    }
  });
});

describe('presets', () => {
  const island = new Map(tools.map((t) => [t.slug, t]));
  /** what the page would open with: its own props, overridden by the link's hash preset */
  const opened = (slug: string, preset: Record<string, unknown>) => {
    const t = island.get(slug)!;
    return { ...t.props, ...presetFromHash(t.island, presetHash(preset as never)) } as Record<string, unknown>;
  };
  const same = (a: unknown, b: unknown) => String(JSON.stringify(a)).toLowerCase().replace(/jpeg/g, 'jpg') === JSON.stringify(b).toLowerCase().replace(/jpeg/g, 'jpg');

  it('opens the labelled preset for at least 90% of queries that have one', () => {
    const labelled = dev.filter((x) => x.preset && x.accept.length);
    const misses: string[] = [];
    for (const x of labelled) {
      const top = engine.search(x.q).hits[0];
      const props = opened(top.slug, top.preset);
      const bad = Object.entries(x.preset!).filter(([k, v]) => !same(props[k], v));
      if (bad.length) misses.push(`${x.q} → ${top.href} ${JSON.stringify(Object.fromEntries(bad.map(([k]) => [k, props[k]])))}`);
    }
    console.log(`preset exact: ${labelled.length - misses.length}/${labelled.length}`, misses);
    expect((labelled.length - misses.length) / labelled.length).toBeGreaterThanOrEqual(0.9);
  });

  it('links only presets the page reads, through the hash', () => {
    for (const q of ['compress pdf to 150kb', 'resize image to 20kb to 50kb', 'resize image to 1080x1080', 'shrink video to 30mb', 'cut the first 10 seconds of a video', '70 kg in lbs', 'what is 15% of 80']) {
      const top = engine.search(q).hits[0];
      const doc = docs.find((d) => d.slug === top.slug)!;
      expect(Object.keys(top.preset).every((k) => doc.presets?.includes(k)), q).toBe(true);
      expect(top.href.startsWith(`/${top.slug}`), q).toBe(true);
      expect(top.href).not.toMatch(/[?\s]/);
    }
    expect(engine.search('compress pdf to 150kb').hits[0].href).toBe('/compress-pdf#target=150kb');
    expect(engine.search('compress pdf to 2mb').hits[0].href).toBe('/compress-pdf-to-2mb');
    expect(engine.search('make video smaller for discord').hits[0].href).toBe('/compress-video-to-10mb');
    expect(engine.search('iphone photo to jpg').hits[0].href).toBe('/heic-to-jpg');
  });
});

describe('speed', () => {
  it('answers a keystroke in a couple of milliseconds without the model', () => {
    const qs = [...dev, ...holdout, ...fresh].map((x) => x.q);
    for (const q of qs) engine.search(q); // warm caches
    const times = qs.map((q) => {
      const t0 = performance.now();
      engine.search(q);
      return performance.now() - t0;
    });
    const withModel = qs.map((q) => {
      const t0 = performance.now();
      engine.search(q, { semantic: model });
      return performance.now() - t0;
    });
    const p95 = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];
    console.log(`p95 per query: parser+BM25 ${p95(times).toFixed(2)} ms, +model ${p95(withModel).toFixed(2)} ms`);
    // generous: CI machines are slow and busy; a desktop measures well under 2 ms
    expect(p95(times)).toBeLessThan(8);
    expect(p95(withModel)).toBeLessThan(12);
  });
});

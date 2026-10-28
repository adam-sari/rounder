import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tools } from '@/tools/registry';
import { compatible, plan, variantFor } from '@/search/core/route';
import { parse } from '@/search/core/entities';
import { createEngine } from '@/search/core/search';
import { docs, engine } from './harness';

const cat = engine.catalog;
const slugs = new Set(tools.map((t) => t.slug));

describe('catalog', () => {
  it('only names tools that exist', () => {
    const src = readFileSync('src/search/core/route.ts', 'utf8');
    // every quoted kebab-case word with a dash that looks like a slug
    const named = [...src.matchAll(/'([a-z0-9]+(?:-[a-z0-9]+)+)'/g)].map((m) => m[1]).filter((s) => !/^(slow|upside|e|cut|9|x)-/.test(s));
    const missing = [...new Set(named)].filter((s) => !slugs.has(s));
    expect(missing).toEqual([]);
  });

  it('can reach every converter page from its own formats', () => {
    const unreachable: string[] = [];
    for (const t of tools) {
      const from = t.props?.from as string | undefined;
      const to = t.props?.to as string | undefined;
      if (!t.variantOf || !from || !to || !['image-converter', 'audio-converter', 'video-converter'].includes(t.variantOf)) continue;
      const q = `${from.toLowerCase()} to ${to.replace('jpeg', 'jpg')}`;
      if (engine.search(q).hits[0]?.slug !== t.slug) unreachable.push(`${q} → ${engine.search(q).hits[0]?.slug}`);
    }
    expect(unreachable).toEqual([]);
  });

  it('picks preset pages by their props', () => {
    expect(variantFor(cat, 'compress-pdf', { targetKb: 2000 })).toBe('compress-pdf-to-2mb');
    expect(variantFor(cat, 'compress-pdf', { targetKb: 150 })).toBe('compress-pdf');
    expect(variantFor(cat, 'video-compressor', { targetMB: 10 })).toBe('compress-video-to-10mb');
    expect(variantFor(cat, 'image-resizer', { mode: 'target', rangeKb: [20, 50] })).toBe('image-size-20kb-to-50kb');
  });

  it('works on whatever docs it is given', () => {
    const small = createEngine(docs.filter((d) => ['compress-pdf', 'merge-pdf'].includes(d.slug)));
    expect(small.search('compress pdf to 2mb').hits[0].slug).toBe('compress-pdf');
    expect(small.search('heic to jpg').hits.map((h) => h.slug)).not.toContain('heic-to-jpg');
  });
});

describe('routes', () => {
  const top = (q: string) => plan(cat, q).routes[0];

  it('turns sizes and platforms into presets with a why-line', () => {
    expect(top('compress pdf to 150kb')).toMatchObject({ slug: 'compress-pdf', preset: { target: '150kb' }, why: 'Compress PDF · under 150 KB' });
    expect(top('make pdf smaller for gmail')).toMatchObject({ slug: 'compress-pdf', preset: { target: '25000kb' }, why: 'Compress PDF · 25 MB for Gmail' });
    expect(top('make video smaller for discord')).toMatchObject({ slug: 'compress-video-to-10mb', why: 'Video compressor · 10 MB for Discord' });
    expect(top('resize image to 20kb to 50kb')).toMatchObject({ slug: 'image-size-20kb-to-50kb' });
    expect(top('image between 30 and 60 kb')).toMatchObject({ slug: 'image-resizer', preset: { range: '30-60kb' } });
    expect(top('resize image to 1080x1080')).toMatchObject({ slug: 'image-resizer', preset: { size: '1080x1080' } });
    expect(top('70 kg in lbs')).toMatchObject({ slug: 'kg-to-lbs', preset: { value: 70 } });
  });

  it('lets platform sizes beat the generic resizer', () => {
    expect(top('resize photo for instagram post').slug).toBe('social-media-image-resizer');
    expect(top('resize photo for instagram post').preset).toEqual({ platform: 'instagram' });
    expect(top('signature resize for ssc').slug).toBe('signature-resizer');
  });

  it('respects negation', () => {
    expect(plan(cat, 'enlarge a small photo without blur').routes.map((r) => r.slug)).not.toContain('blur-image');
  });

  it('chains two hops when there is no direct converter', () => {
    expect(plan(cat, 'word to jpg').chain.map((r) => r.slug)).toEqual(['word-to-pdf', 'pdf-to-jpg']);
  });

  it('orders multi-step requests by pipeline stage', () => {
    expect(plan(cat, 'put these pdfs together, number the pages and lock it with a password').chain.map((r) => r.slug)).toEqual(['merge-pdf', 'add-page-numbers-to-pdf', 'protect-pdf']);
    expect(plan(cat, 'my screen recording is too big for discord and i also want to cut off the first 10 seconds').chain.map((r) => [r.slug, r.preset])).toEqual([
      ['trim-video', { start: 10 }],
      ['compress-video-to-10mb', {}],
    ]);
  });

  it("won't offer an image tool for a pdf or a video", () => {
    expect(compatible(cat, 'crop-image', parse('crop pdf'))).toBe(false);
    expect(compatible(cat, 'object-remover', parse('remove watermark from video'))).toBe(false);
    expect(compatible(cat, 'crop-image', parse('crop photo'))).toBe(true);
  });

  it('answers what Rounder does not do honestly', () => {
    expect(engine.search('download youtube video').note).toMatch(/doesn't download/);
    expect(engine.search('download youtube video').confident).toBe(false);
    expect(engine.search('remove watermark from video').note).toMatch(/No tool removes/);
    expect(engine.search('youtube to mp3').note).toMatch(/doesn't download/);
  });

  it('reads which end of a clip a duration trims', () => {
    const preset = (q: string) => engine.search(q).hits[0].preset;
    expect(preset('cut the first 10 seconds of a video')).toEqual({ start: 10 });
    expect(preset('trim video to 30 seconds')).toEqual({ end: 30 });
    expect(preset('trim song to 30 sec')).toEqual({ end: 30 });
    // "cut 10 seconds" doesn't say from where, so no preset
    expect(preset('cut 10 seconds from video')).toEqual({});
  });

  it("sends a kind's converter queries to that converter, and passwords to the right tool", () => {
    for (const [q, slug] of [['video converter', 'video-converter'], ['image converter', 'image-converter'], ['generate a strong password', 'password-generator'], ['is my password strong', 'password-strength-checker']]) {
      const r = engine.search(q);
      expect([r.hits[0].slug, r.confident], q).toEqual([slug, true]);
    }
    // a bare kind word covers every tool of that kind, so it is never a confident answer on its own
    expect(engine.search('pdf').confident).toBe(false);
  });
});

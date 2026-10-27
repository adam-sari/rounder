import { describe, expect, it } from 'vitest';
import { notesProblems, toolBySlug, tools, variantsOf } from '@/tools/registry';
import { buildIco, ICO_SIZES } from '@/tools/lib/favicon/ico';
import type { LimitId } from '@/tools/lib/character-counter/limits';

// the Tier 1 pages that reuse an island in a preset state, with the props each island reads
const pages: Record<string, { parent: string; props: Record<string, unknown> }> = {
  'character-counter': { parent: 'word-counter', props: { focus: 'chars', limits: ['x', 'sms', 'instagram', 'youtube', 'meta'] satisfies LimitId[] } },
  'mp4-to-mp3': { parent: 'video-to-mp3', props: { from: 'MP4' } },
  'mp4-to-gif': { parent: 'video-to-gif', props: { from: 'MP4' } },
  'mov-to-gif': { parent: 'video-to-gif', props: { from: 'MOV' } },
  'png-to-pdf': { parent: 'jpg-to-pdf', props: { size: 'fit' } },
  'heic-to-pdf': { parent: 'jpg-to-pdf', props: { compress: true } },
  'png-to-ico': { parent: 'favicon-generator', props: { output: 'ico' } },
  'jpg-to-svg': { parent: 'png-to-svg', props: { from: 'jpg' } },
};

describe('preset pages', () => {
  for (const [slug, { parent, props }] of Object.entries(pages)) {
    it(`${slug} opens ${parent}'s island preset, with its own copy`, () => {
      const t = toolBySlug[slug];
      expect(t, slug).toBeDefined();
      expect(t.variantOf).toBe(parent);
      expect(t.island).toBe(toolBySlug[parent].island);
      expect(t.props).toEqual(props);
      // linked from the parent's "Popular conversions" / "Shortcuts"
      expect(variantsOf(parent).map((v) => v.slug)).toContain(slug);
      expect(t.title.length, 'title').toBeLessThanOrEqual(65);
      expect(t.description.length, 'description').toBeLessThanOrEqual(160);
      expect(t.steps).toHaveLength(3);
      expect(t.faq.length).toBeGreaterThanOrEqual(3);
      expect(t.faq.length).toBeLessThanOrEqual(5);
      expect(t.related?.length).toBeGreaterThan(0);
      expect(notesProblems(t.notes)).toEqual([]);
      // nothing copied from the main page
      const main = toolBySlug[parent];
      expect(t.title).not.toBe(main.title);
      expect(t.description).not.toBe(main.description);
      for (const f of t.faq.slice(0, -1)) expect(main.faq.map((m) => m.a)).not.toContain(f.a);
    });
  }

  it('gives every page a unique slug, title and description', () => {
    for (const key of ['slug', 'title', 'description'] as const) expect(new Set(tools.map((t) => t[key])).size, key).toBe(tools.length);
  });

  it('cites a source for every character limit', () => {
    const limits = toolBySlug['character-counter'].notes?.limits ?? [];
    expect(limits.length).toBe(5);
    for (const l of limits) expect(l.source).toMatch(/^https:\/\//);
  });
});

describe('ICO sizes', () => {
  it('keeps favicons to 16–48 and goes up to 256 for Windows', () => {
    expect(ICO_SIZES.favicon).toEqual([16, 32, 48]);
    expect(Math.max(...ICO_SIZES.windows)).toBe(256);
    const ico = buildIco(ICO_SIZES.windows.map((size) => ({ size, png: new Uint8Array(4) })));
    expect(new DataView(ico.buffer).getUint16(4, true)).toBe(7);
  });
});

import { describe, expect, it } from 'vitest';
import { toolBySlug, variantsOf } from '@/tools/registry';
import { isSizePreset, sizePresets } from '@/tools/lib/exact-size/pages';

// The doorway checklist for exact-size pages: each opens a real tool state, has copy of its own, and is linked from
// its main tool (the "Common targets" block) and the hub.
describe('exact-size pages', () => {
  const pages = sizePresets();

  it('exist, about 25 of them, each with its own words', () => {
    expect(pages.length).toBeGreaterThanOrEqual(20);
    for (const p of pages) {
      expect(p.title.length, p.slug).toBeLessThanOrEqual(65);
      expect(p.description.length, p.slug).toBeLessThanOrEqual(160);
      expect(p.steps, p.slug).toHaveLength(3);
      expect(p.faq.length, p.slug).toBeGreaterThanOrEqual(3);
      expect(p.faq.length, p.slug).toBeLessThanOrEqual(5);
    }
    // no two pages share a title, description or first question: copy is written per size, not number-swapped
    for (const key of ['title', 'description', 'tagline'] as const) expect(new Set(pages.map((p) => p[key])).size, key).toBe(pages.length);
    const own = pages.map((p) => p.faq[0].a);
    expect(new Set(own).size).toBe(pages.length);
  });

  it('open their tool in the preset state, under a main tool that links back', () => {
    const island: Record<string, string> = { 'compress-pdf': 'CompressPdf', 'image-resizer': 'ImageResizer', 'video-compressor': 'VideoCompressor', 'jpg-to-pdf': 'ImagesToPdf' };
    for (const p of pages) {
      expect(p.variantOf && toolBySlug[p.variantOf], p.slug).toBeDefined();
      expect(p.island, p.slug).toBe(island[p.variantOf!]);
      expect(Object.keys(p.props ?? {}).length, p.slug).toBeGreaterThan(0);
      expect(variantsOf(p.variantOf!).filter(isSizePreset), p.slug).toContainEqual(p);
    }
  });

  it('say in the slug or name the number the tool is set to', () => {
    for (const p of pages) {
      const kb = (p.props?.targetKb as number | undefined) ?? (p.props?.targetMB as number | undefined);
      if (!kb || !/-to-|-under-/.test(p.slug)) continue;
      const shown = kb >= 1000 && p.props?.targetKb ? `${kb / 1000}mb` : `${kb}${p.props?.targetMB ? 'mb' : 'kb'}`;
      expect(p.slug, p.slug).toContain(shown);
    }
  });
});

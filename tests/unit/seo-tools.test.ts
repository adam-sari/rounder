import { describe, expect, it } from 'vitest';
import { adsAllowed, nextSteps, toolBySlug, tools, toolSource, variantsOf } from '@/tools/registry';
import { SITE } from '@/site';

describe('tool links and ad flags', () => {
  it('points next and related only at tools that exist', () => {
    for (const t of tools) for (const s of [...(t.next ?? []), ...(t.related ?? [])]) expect(toolBySlug[s], `${t.slug} → ${s}`).toBeDefined();
  });

  it("gives variant pages their main tool's next steps", () => {
    expect(nextSteps(toolBySlug['heic-to-jpg']).map((t) => t.slug)).toEqual(['image-compressor', 'image-resizer']);
    expect(variantsOf('audio-converter').map((t) => t.slug)).toContain('flac-to-mp3');
  });

  it('keeps exactly the privacy-critical tools ad-free', () => {
    expect(tools.filter((t) => t.noAds).map((t) => t.slug).sort()).toEqual([...SITE.adFree].sort());
  });

  it('keeps preset pages of an ad-free tool ad-free too', () => {
    const preset = { ...toolBySlug['protect-pdf'], slug: 'protect-pdf-preset', noAds: undefined, variantOf: 'protect-pdf' };
    expect(adsAllowed(preset)).toBe(false);
    expect(adsAllowed(toolBySlug['heic-to-jpg'])).toBe(true);
    for (const t of tools) if (SITE.adFree.includes(t.slug) || SITE.adFree.includes(t.variantOf ?? '')) expect(adsAllowed(t), t.slug).toBe(false);
  });

  it('knows the source file of every tool, for sitemap dates', () => {
    for (const t of tools) expect(toolSource[t.slug], t.slug).toMatch(/^src\/tools\/(registry|defs\/[\w-]+)\.ts$/);
  });
});

import { describe, expect, it } from 'vitest';
import tools from '@/tools/defs/image-converter';
import { filePrivacyFaq } from '@/tools/types';
import { acceptFor, dropTitle } from '@/tools/lib/image-converter/formats';

const batch = new Set(
  'image-compressor image-converter heic-to-jpg png-to-jpg jpg-to-png webp-to-jpg png-to-webp image-resizer crop-image rotate-image watermark-image meme-generator collage-maker instagram-grid-maker passport-photo-maker blur-image exif-remover image-color-picker favicon-generator svg-to-png png-to-svg screenshot-beautifier image-to-ascii pixel-art-maker'.split(' '),
);

describe('image converter pages', () => {
  const slugs = tools.map((t) => t.slug);

  it('puts the main tool first and the rest as variants', () => {
    expect(tools[0].slug).toBe('image-converter');
    expect(tools.slice(1).every((t) => t.variantOf === 'image-converter')).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('derives slugs from the formats the page converts', () => {
    expect(slugs).toContain('heic-to-jpg');
    expect(slugs).toContain('jpg-to-avif');
    expect(tools.find((t) => t.slug === 'heic-to-jpg')?.props).toEqual({ from: 'heic', to: 'jpeg' });
  });

  it.each(tools.map((t) => [t.slug, t] as const))('%s meets the page copy rules', (_, t) => {
    expect(t.title.length).toBeLessThanOrEqual(65);
    expect(t.description.length).toBeLessThanOrEqual(160);
    expect(t.h1.match(/\*[^*]+\*/g)).toHaveLength(1);
    expect(t.keywords.length).toBeGreaterThanOrEqual(6);
    expect(t.keywords.length).toBeLessThanOrEqual(10);
    expect(t.steps).toHaveLength(3);
    expect(t.faq.length).toBeGreaterThanOrEqual(3);
    expect(t.faq.length).toBeLessThanOrEqual(5);
    expect(t.faq.at(-1)).toBe(filePrivacyFaq);
    expect(t.related!.length).toBeGreaterThanOrEqual(2);
    expect(t.related!.length).toBeLessThanOrEqual(4);
    for (const r of t.related!) expect(batch.has(r) || slugs.includes(r), r).toBe(true);
  });
});

describe('dropzone tuning', () => {
  it('lists the source format first but still accepts any image', () => {
    expect(acceptFor('heic').startsWith('.heic,.heif')).toBe(true);
    expect(acceptFor('heic')).toContain('image/*');
    expect(acceptFor()).toBe('image/*,.heic,.heif,.avif');
  });

  it('names the source format in the drop title', () => {
    expect(dropTitle('webp')).toBe('Drop WebP images here');
    expect(dropTitle()).toBe('Drop images here');
  });
});

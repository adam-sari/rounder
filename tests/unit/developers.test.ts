import { describe, expect, it } from 'vitest';
import { ops, snippetsFor } from '@/developers';
import { toolBySlug, tools } from '@/tools/registry';

describe('developer snippets', () => {
  it('every npm op is a tool page (file-info aside)', () => {
    for (const op of ops) if (op.slug !== 'file-info') expect(toolBySlug[op.slug], op.slug).toBeDefined();
  });

  it("writes a tool's own example", () => {
    const s = snippetsFor(toolBySlug['compress-pdf'])!;
    expect(s.cli).toBe('npx roundertools compress-pdf report.pdf');
    expect(s.sdk).toContain("await pdf.compress('report.pdf')");
    expect(s.needs).toEqual([]);
  });

  it("uses a preset page's slug on the command line and its preset in code", () => {
    const s = snippetsFor(toolBySlug['compress-pdf-to-100kb'])!;
    expect(s.cli).toBe('npx roundertools compress-pdf-to-100kb report.pdf');
    expect(s.sdk).toContain("pdf.compress('report.pdf', { target: '100kb' })");
    const mov = snippetsFor(toolBySlug['mov-to-mp4'])!;
    expect(mov.cli).toBe('npx roundertools mov-to-mp4 screen.mov');
    expect(mov.sdk).toContain("media.convert('screen.mov', { to: 'mp4' })");
    expect(mov.needs).toEqual(['ffmpeg on your computer']);
  });

  it('shows nothing for browser-only tools', () => {
    expect(snippetsFor(toolBySlug['word-counter'])).toBeNull();
    expect(snippetsFor(toolBySlug['screen-recorder'])).toBeNull();
  });

  it("shows nothing on preset pages the op can't reproduce", () => {
    // a mode the SDK lacks, or an input format it can't read: the main tool's command would do something else
    for (const slug of ['increase-image-size-in-kb', 'resize-image-in-cm', 'jpg-to-pdf-under-200kb', 'heic-to-pdf', 'heic-to-jpg']) {
      if (toolBySlug[slug]) expect(snippetsFor(toolBySlug[slug]), slug).toBeNull();
    }
  });

  it('shows the matching example on pages that preset nothing', () => {
    const s = snippetsFor(toolBySlug['delete-pdf-pages'])!;
    expect(s.cli).toMatch(/^npx roundertools delete-pdf-pages \S+\.pdf --remove /);
  });

  it('covers a good share of the site', () => {
    expect(tools.filter((t) => snippetsFor(t)).length).toBeGreaterThan(60);
  });
});

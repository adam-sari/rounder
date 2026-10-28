import { describe, expect, it } from 'vitest';
import { tools } from '@/tools/registry';
import heights from '@/tools/island-heights.json';

// the tool placeholder reserves each tool's measured first-screen height (CLS); a new tool needs measuring
describe('island heights', () => {
  const table = heights as Record<string, number[]>;

  it('has phone, tablet and desktop heights for every tool page', () => {
    const missing = tools.filter((t) => !table[t.slug]).map((t) => t.slug);
    expect(missing, 'run scripts/measure-islands.mjs (instructions at its top)').toEqual([]);
    for (const [slug, hs] of Object.entries(table)) {
      expect(hs, slug).toHaveLength(3);
      for (const h of hs) expect(h, slug).toBeGreaterThan(40);
    }
  });

  it('lists no tools that no longer exist', () => {
    const slugs = new Set(tools.map((t) => t.slug));
    expect(Object.keys(table).filter((s) => !slugs.has(s))).toEqual([]);
  });
});

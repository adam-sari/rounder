import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Cloudflare Pages: at most 100 rules, and every matching rule applies (a repeated header is comma-joined)
const rules = new Map<string, string[]>();
let current = '';
for (const line of readFileSync('public/_headers', 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.startsWith('#')) continue;
  if (!/^\s/.test(line)) rules.set((current = line.trim()), []);
  else rules.get(current)!.push(line.trim().split(':')[0].toLowerCase());
}

describe('_headers', () => {
  it('stays under the 100-rule cap', () => {
    expect(rules.size).toBeLessThanOrEqual(100);
  });

  it('never repeats a header that /* already sets', () => {
    const global = new Set(rules.get('/*'));
    for (const [path, names] of rules) if (path !== '/*') expect(names.filter((n) => global.has(n)), path).toEqual([]);
  });

  it('keeps the pages.dev copies out of search, and only them', () => {
    const noindex = [...rules].filter(([, names]) => names.includes('x-robots-tag')).map(([path]) => path);
    expect(noindex.sort()).toEqual(['https://:project.pages.dev/*', 'https://:version.:project.pages.dev/*']);
  });
});

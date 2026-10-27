import { describe, expect, it } from 'vitest';
import { jaccard, mainText, shingles } from '../../scripts/seo/check-similarity.mjs';

const page = (body: string) =>
  `<html><body><header>site header</header><main id="main"><nav aria-label="Breadcrumb">index / pdf</nav><h1>Compress <em>PDF</em></h1>` +
  `<section class="card" aria-label="Tool"><div>warming up the tool…</div></section>${body}` +
  `<section class="mt-20"><h2 class="text-4xl">More pdf tools</h2><a href="/merge-pdf">Merge PDF</a></section></main><footer>footer</footer></body></html>`;

describe('check-similarity', () => {
  it('keeps only the main text: no breadcrumb, tool shell, related cards, scripts or markup', () => {
    const text = mainText(page('<p>Scans shrink the most &amp; text stays sharp.</p><script>var x = 1</script><svg><path d="M0"/></svg>'));
    expect(text).toBe('Compress PDF Scans shrink the most & text stays sharp.');
  });

  it('builds lowercased word 5-grams without punctuation', () => {
    expect([...shingles('One, two THREE four five six.')]).toEqual(['one two three four five', 'two three four five six']);
    expect(shingles('too short').size).toBe(0);
  });

  it('scores identical text 1, unrelated text 0, and a partial overlap in between', () => {
    const a = shingles('the quick brown fox jumps over the lazy dog today');
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, shingles('lorem ipsum dolor sit amet consectetur adipiscing elit sed do'))).toBe(0);
    const b = shingles('the quick brown fox jumps over the lazy cat today');
    expect(jaccard(a, b)).toBeGreaterThan(0);
    expect(jaccard(a, b)).toBeLessThan(1);
  });
});

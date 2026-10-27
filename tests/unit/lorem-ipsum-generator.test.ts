import { describe, expect, it } from 'vitest';
import { LIMITS, generate, render, type LoremOptions } from '@/tools/lib/lorem-ipsum/generate';

const base: LoremOptions = { unit: 'paragraphs', count: 3, flavor: 'latin', classicStart: true, seed: 42 };
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('generate', () => {
  it('is deterministic for a seed', () => {
    expect(generate(base)).toEqual(generate(base));
    expect(generate({ ...base, seed: 43 })).not.toEqual(generate(base));
  });

  it('starts with the classic opening when asked', () => {
    expect(generate(base)[0].startsWith('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')).toBe(true);
    expect(generate({ ...base, classicStart: false })[0].startsWith('Lorem ipsum dolor sit amet, consectetur')).toBe(false);
  });

  it('returns the requested number of paragraphs and items', () => {
    expect(generate(base)).toHaveLength(3);
    expect(generate({ ...base, unit: 'items', count: 7 })).toHaveLength(7);
  });

  it('returns exactly the requested number of words', () => {
    for (const flavor of ['latin', 'english'] as const) {
      for (const count of [1, 3, 8, 250]) {
        const [text] = generate({ ...base, unit: 'words', count, flavor });
        expect(wordCount(text)).toBe(count);
        expect(text.endsWith('.')).toBe(true);
      }
    }
    expect(generate({ ...base, unit: 'words', count: 3 })[0]).toBe('Lorem ipsum dolor.');
  });

  it('returns the requested number of sentences', () => {
    const [text] = generate({ ...base, unit: 'sentences', count: 5, flavor: 'english' });
    expect(text.match(/[.!?](\s|$)/g)).toHaveLength(5);
  });

  it('never uses Latin in the English flavor', () => {
    const text = generate({ ...base, flavor: 'english', count: 10 }).join(' ');
    expect(text).not.toMatch(/lorem|ipsum|dolor/i);
  });

  it('clamps silly counts', () => {
    expect(generate({ ...base, count: 0 })).toHaveLength(1);
    expect(generate({ ...base, count: Number.NaN })).toHaveLength(1);
    expect(generate({ ...base, unit: 'items', count: 1e9 })).toHaveLength(LIMITS.items);
  });
});

describe('render', () => {
  it('formats paragraphs', () => {
    expect(render(['a', 'b'], 'paragraphs', 'text')).toBe('a\n\nb');
    expect(render(['a', 'b'], 'paragraphs', 'markdown')).toBe('a\n\nb');
    expect(render(['a', 'b'], 'paragraphs', 'html')).toBe('<p>a</p>\n\n<p>b</p>');
  });

  it('formats lists', () => {
    expect(render(['a', 'b'], 'items', 'text')).toBe('a\nb');
    expect(render(['a', 'b'], 'items', 'markdown')).toBe('- a\n- b');
    expect(render(['a', 'b'], 'items', 'html')).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>');
  });

  it('escapes HTML', () => {
    expect(render(['a < b & c'], 'sentences', 'html')).toBe('<p>a &lt; b &amp; c</p>');
  });
});

import { describe, expect, it } from 'vitest';
import def from '@/tools/defs/grammar-checker';
import { privacyFaq } from '@/tools/types';
import { applyEdits, editSegments } from '@/tools/lib/llm/diff';
import type { GenerateRequest, Llm } from '@/tools/lib/llm/engine';
import { applyFixes, articleFor, excerpt, looksEnglish, quickCheck } from '@/tools/lib/llm/quick-checks';
import { proofreadText } from '@/tools/lib/llm/tasks';

const fixed = (text: string) => applyFixes(text, quickCheck(text));

describe('quickCheck', () => {
  it('catches repeated words, spacing and punctuation', () => {
    expect(fixed('This is the the best  part , really.')).toBe('This is the best part, really.');
    expect(fixed('One,two and three.Then more.')).toBe('One, two and three. Then more.');
  });

  it('fixes a/an from the sound, not just the letter', () => {
    expect(fixed('It was a apple, an banana and a hour in an university with a honest user.')).toBe('It was an apple, a banana and an hour in a university with an honest user.');
    expect(fixed('An European trip took an one-way ticket.')).toBe('A European trip took a one-way ticket.');
    expect(articleFor('FBI')).toBeNull();
    expect(articleFor('8th')).toBeNull();
    expect(quickCheck('Part a and part b of the form.')).toEqual([]);
  });

  it('fixes common mix-ups and misspellings, keeping case', () => {
    expect(fixed('You could of told me. It is more then enough, definately.')).toBe('You could have told me. It is more than enough, definitely.');
    expect(fixed('Teh plan is to recieve it. i think so.')).toBe('The plan is to receive it. I think so.');
  });

  it('capitalizes sentence starts but not after abbreviations', () => {
    expect(fixed('It rained. we stayed in.')).toBe('It rained. We stayed in.');
    expect(quickCheck('Bring fruit, e.g. apples, and tools etc. for the trip. See the U.S. office.')).toEqual([]);
    expect(quickCheck('Wait... then it came.')).toEqual([]);
  });

  it('leaves clean text and good doubles alone', () => {
    const clean = 'I think that that is fine. She had had enough by 3 p.m. on the 1st of May, i.e. early. Options: (i) stay or (ii) go.';
    expect(quickCheck(clean)).toEqual([]);
  });

  it('runs the English rules only on English text', () => {
    expect(looksEnglish('Voy a esta casa con mi hermano y la familia.')).toBe(false);
    expect(quickCheck('Voy a esta casa con mi hermano y la familia.')).toEqual([]);
    expect(quickCheck('Voy  a casa.').map((i) => i.kind)).toEqual(['spacing']);
  });

  it('shows the problem in context', () => {
    const text = 'A long sentence with the the problem in the middle of it all.';
    const [issue] = quickCheck(text);
    const x = excerpt(text, issue, 10);
    expect(x.target).toBe('the the');
    expect(x.before.endsWith('with ')).toBe(true);
    expect(x.after.endsWith('…')).toBe(true);
  });
});

describe('AI proofread review', () => {
  it('lets each change be accepted or rejected', () => {
    const segs = editSegments('Their going to the park tomorow.', "They're going to the park tomorrow.");
    const ids = segs.flatMap((s) => (s.kind === 'edit' ? [s.id] : []));
    expect(ids).toHaveLength(2);
    expect(applyEdits(segs, new Set([ids[0]]))).toBe('Their going to the park tomorrow.');
    expect(applyEdits(segs, new Set(ids))).toBe('Their going to the park tomorow.');
  });

  it("prefers Chrome's proofreader and keeps the text's layout", async () => {
    const asked: string[] = [];
    const llm: Llm = {
      engine: 'builtin',
      name: 'fake',
      maxChars: 9000,
      language: async () => 'en',
      proofread: async (text) => (asked.push(text), text.trim().replace('teh', 'the')),
      generate: async () => {
        throw new Error('not used');
      },
    };
    expect(await proofreadText(llm, '  teh cat.\n\nok.\n')).toBe('  the cat.\n\nok.\n');
    expect(asked).toHaveLength(1);
  });

  it("sends non-English text to the Prompt API, since Chrome's proofreader reads English only", async () => {
    const used: string[] = [];
    const llm: Llm = {
      engine: 'builtin',
      name: 'fake',
      maxChars: 9000,
      language: async () => 'de',
      proofread: async (text) => (used.push('proofread'), text),
      generate: async (r) => (used.push(`generate:${r.lang}`), 'Das ist gut.'),
    };
    expect(await proofreadText(llm, 'Das ist gutt.')).toBe('Das ist gut.');
    expect(used).toEqual(['generate:de']);
  });

  it('stays quick on long texts full of lowercase sentence starts', () => {
    const text = 'it ends. then more. '.repeat(5000);
    const t = performance.now();
    expect(quickCheck(text).length).toBeGreaterThan(5000);
    expect(performance.now() - t).toBeLessThan(1500);
  });

  it('falls back to a prompt, and keeps a part the model returned empty', async () => {
    const calls: GenerateRequest[] = [];
    const llm: Llm = {
      engine: 'local',
      name: 'fake',
      maxChars: 6000,
      language: async () => undefined,
      generate: async (r) => (calls.push(r), 'Corrected text: '),
    };
    expect(await proofreadText(llm, 'Fine as is.')).toBe('Fine as is.');
    expect(calls[0].system).toMatch(/proofreader/);
    expect(calls[0].temperature).toBe(0);
  });
});

describe('grammar-checker def', () => {
  it('meets the page rules', () => {
    expect(def.slug).toBe('grammar-checker');
    expect(def.category).toBe('ai');
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
    expect(def.keywords.length).toBeGreaterThanOrEqual(6);
    expect(def.keywords.length).toBeLessThanOrEqual(10);
    expect(def.steps).toHaveLength(3);
    expect(def.faq.at(-1)).toBe(privacyFaq);
  });
});

import { describe, expect, it } from 'vitest';
import def from '@/tools/defs/text-summarizer';
import { privacyFaq } from '@/tools/types';
import type { GenerateRequest, Llm, SummarizerRequest } from '@/tools/lib/llm/engine';
import { formatSummary, summaryPrompt } from '@/tools/lib/llm/prompts';
import { builtinSummary, summarizeText, type Stage } from '@/tools/lib/llm/tasks';
import { chunkText } from '@/tools/lib/llm/text';

const para = (n: number, word = 'word') => `${Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ')}.`;

function fakeLocal(maxChars: number, reply: (r: GenerateRequest) => string): Llm & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];
  return {
    calls,
    engine: 'local',
    name: 'fake',
    maxChars,
    language: async () => undefined,
    async generate(r) {
      calls.push(r);
      const out = reply(r);
      r.onText?.(out.slice(0, 3));
      r.onText?.(out);
      return out;
    },
  };
}

describe('chunkText', () => {
  it('keeps every character, in order, under the limit', () => {
    const text = [para(40), para(60), para(10), para(200)].join('\n\n');
    const chunks = chunkText(text, 500);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
  });

  it('breaks between paragraphs before sentences', () => {
    const text = `${para(20, 'a')}\n\n${para(20, 'b')}`;
    const chunks = chunkText(text, text.length - 10);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].startsWith('b0')).toBe(true);
  });

  it('returns short text whole', () => {
    expect(chunkText('Hello there.', 100)).toEqual(['Hello there.']);
  });
});

describe('prompts', () => {
  it('asks for the chosen format and length, text first', () => {
    const p = summaryPrompt({ format: 'points', length: 'medium' }, 'Some text.');
    expect(p.prompt.indexOf('Some text.')).toBeLessThan(p.prompt.indexOf('5 most important points'));
    expect(p.system).toMatch(/never add facts/);
    expect(summaryPrompt({ format: 'headline', length: 'long' }, 'x').maxTokens).toBeLessThan(60);
  });

  it('tidies bullets, headlines and TL;DR labels', () => {
    expect(formatSummary('* **One**\n2. Two\n\n• Three', 'points')).toBe('- One\n- Two\n- Three');
    expect(formatSummary('"Rates rise again."', 'headline')).toBe('Rates rise again');
    expect(formatSummary('TL;DR: It works.', 'tldr')).toBe('It works.');
  });

  it("maps formats onto Chrome's summarizer", () => {
    expect(builtinSummary({ format: 'points', length: 'short' })).toEqual({ type: 'key-points', length: 'short', format: 'markdown' });
    expect(builtinSummary({ format: 'tldr', length: 'long' })).toMatchObject({ type: 'tldr', length: 'short' });
    expect(builtinSummary({ format: 'paragraph', length: 'short' })).toMatchObject({ type: 'tldr', length: 'medium' });
    expect(builtinSummary({ format: 'notes' })).toMatchObject({ type: 'key-points', length: 'long' });
  });
});

describe('summarizeText', () => {
  it('summarizes short text in one request and streams it', async () => {
    const llm = fakeLocal(5000, () => 'Here is the summary:\nIt is short.');
    const seen: string[] = [];
    const out = await summarizeText(llm, para(50), { format: 'paragraph', length: 'short' }, { onText: (t) => seen.push(t) });
    expect(out).toBe('It is short.');
    expect(llm.calls).toHaveLength(1);
    expect(seen.at(-1)).toBe('It is short.');
  });

  it('condenses long text part by part, then summarizes the notes', async () => {
    const text = Array.from({ length: 6 }, () => para(80)).join('\n\n');
    const llm = fakeLocal(1200, (r) => (r.prompt.includes('key facts') ? '- a note' : '- one\n- two\n- three'));
    const stages: (Stage | null)[] = [];
    const out = await summarizeText(llm, text, { format: 'points', length: 'short' }, { onStage: (s) => stages.push(s) });
    const notes = llm.calls.filter((c) => c.prompt.includes('key facts'));
    expect(notes.length).toBeGreaterThan(1);
    expect(llm.calls).toHaveLength(notes.length + 1);
    expect(llm.calls.at(-1)!.prompt).toContain('- a note');
    expect(stages[0]).toEqual({ part: 1, parts: notes.length });
    expect(stages.at(-1)).toBeNull();
    expect(out).toBe('- one\n- two\n- three');
  });

  it("uses Chrome's summarizer when there is one and retries smaller when the input is too long", async () => {
    const seen: number[] = [];
    const llm: Llm = {
      engine: 'builtin',
      name: 'fake',
      maxChars: 8000,
      language: async () => 'en',
      async summarize(text: string, r: SummarizerRequest) {
        seen.push(text.length);
        if (text.length > 3000) throw Object.assign(new Error('too long'), { name: 'QuotaExceededError' });
        return r.type === 'key-points' ? '* note' : 'Final.';
      },
    };
    const out = await summarizeText(llm, Array.from({ length: 10 }, () => para(100)).join('\n\n'), { format: 'tldr', length: 'medium' });
    expect(out).toBe('Final.');
    expect(seen[0]).toBeGreaterThan(3000);
    expect(seen.slice(1).every((n) => n <= 4000)).toBe(true);
  });

  it('stops when the signal aborts', async () => {
    const ctl = new AbortController();
    const llm = fakeLocal(1000, (r) => {
      ctl.abort();
      r.signal?.throwIfAborted();
      return '';
    });
    await expect(summarizeText(llm, para(400), { format: 'paragraph', length: 'short' }, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('text-summarizer def', () => {
  it('meets the page rules', () => {
    expect(def.slug).toBe('text-summarizer');
    expect(def.category).toBe('ai');
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
    expect(def.keywords.length).toBeGreaterThanOrEqual(6);
    expect(def.keywords.length).toBeLessThanOrEqual(10);
    expect(def.steps).toHaveLength(3);
    expect(def.faq.at(-1)).toBe(privacyFaq);
    expect(def.faq.some((f) => /Apache-2\.0/.test(f.a))).toBe(true);
    expect(def.related.length).toBeGreaterThanOrEqual(2);
  });
});

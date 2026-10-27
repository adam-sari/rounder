import { describe, expect, it } from 'vitest';
import def from '@/tools/defs/paraphrasing-tool';
import { privacyFaq } from '@/tools/types';
import { applyEdits, changedShare, changedSpans, editSegments, highlightRuns } from '@/tools/lib/llm/diff';
import type { GenerateRequest, Llm } from '@/tools/lib/llm/engine';
import { alternativesPrompt, MODES, paraphrasePrompt } from '@/tools/lib/llm/prompts';
import { paraphraseText, rewriteInParts } from '@/tools/lib/llm/tasks';
import { cleanOutput, keepEdges, parseAlternatives, splitSentences } from '@/tools/lib/llm/text';

describe('splitSentences', () => {
  it('tiles the text', () => {
    const text = 'First one. Second? Third!\n\nNew paragraph here.';
    const spans = splitSentences(text);
    expect(spans.map((s) => text.slice(s.start, s.end)).join('')).toBe(text);
    expect(spans.length).toBeGreaterThanOrEqual(4);
    expect(text.slice(spans[1].start, spans[1].end).trim()).toBe('Second?');
  });
});

describe('word diff', () => {
  const before = 'The quick brown fox jumps over the lazy dog.';
  const after = 'The fast brown fox leaps over the lazy dog.';

  it('finds edits and rebuilds either side', () => {
    const segs = editSegments(before, after);
    const edits = segs.filter((s) => s.kind === 'edit');
    expect(edits).toHaveLength(2);
    expect(applyEdits(segs)).toBe(after);
    expect(applyEdits(segs, new Set([0, 1]))).toBe(before);
    expect(applyEdits(segs, new Set([1]))).toBe('The fast brown fox jumps over the lazy dog.');
    expect(changedShare(segs)).toBeCloseTo(2 / 9);
  });

  it('merges edits split only by a space', () => {
    const segs = editSegments('I could of went home.', 'I could have gone home.');
    const edits = segs.filter((s) => s.kind === 'edit');
    expect(edits).toEqual([{ kind: 'edit', id: 0, from: 'of went', to: 'have gone' }]);
  });

  it('marks the new words in the edited text', () => {
    const segs = editSegments(before, after);
    const spans = changedSpans(segs);
    expect(spans.map((s) => after.slice(s.start, s.end))).toEqual(['fast', 'leaps']);
    const runs = highlightRuns(after, spans, 4, 30);
    expect(runs.map((r) => r.text).join('')).toBe(after.slice(4, 30));
    expect(runs.filter((r) => r.changed).map((r) => r.text)).toEqual(['fast', 'leaps']);
  });
});

describe('model output', () => {
  it('strips preambles, labels and fences', () => {
    expect(cleanOutput('Sure! Here is the rewrite:\n\nNew words.')).toBe('New words.');
    expect(cleanOutput('<think>\n\n</think>\n\nRewritten text: Fine.')).toBe('Fine.');
    expect(cleanOutput('<<<\nInside.\n>>>')).toBe('Inside.');
  });

  it('keeps a lead-in the original itself had', () => {
    expect(cleanOutput('Here are the results:\nAll good.', 'Here are the results:\nall good')).toBe('Here are the results:\nAll good.');
  });

  it('parses alternatives without repeats or the original', () => {
    const raw = '1. "Go home now."\n2. Head home now.\n3. Go home now.\n4) Leave for home.\n5. Return home.';
    expect(parseAlternatives(raw, 'Go home now.')).toEqual(['Head home now.', 'Leave for home.', 'Return home.']);
  });

  it("puts the original's whitespace back", () => {
    expect(keepEdges('\n  Hello.  \n\n', 'Hi.\n')).toBe('\n  Hi.  \n\n');
  });
});

describe('paraphraseText', () => {
  it('rewrites part by part and keeps paragraph breaks', async () => {
    const calls: GenerateRequest[] = [];
    const llm: Llm = {
      engine: 'local',
      name: 'fake',
      maxChars: 6000,
      language: async () => undefined,
      async generate(r) {
        calls.push(r);
        const text = r.prompt.match(/<<<\n([\s\S]*?)\n>>>/)![1];
        return `Here is the rewrite:\n${text.toUpperCase()}`;
      },
    };
    const paras = Array.from({ length: 4 }, (_, i) => `Paragraph ${i} ${'words '.repeat(80).trim()}.`);
    const out = await paraphraseText(llm, paras.join('\n\n'), 'formal');
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0].system).toMatch(/Keep the meaning/);
    expect(calls[0].prompt).toContain(MODES.formal.task);
    expect(out).toBe(paras.map((p) => p.toUpperCase()).join('\n\n'));
  });

  it('streams the whole text so far', async () => {
    const seen: string[] = [];
    await rewriteInParts('One.\n\nTwo.', 5, async (part, onText) => (onText('X'), part.trim().toLowerCase()), { onText: (t) => seen.push(t) });
    expect(seen.at(-1)).toBe('one.\n\ntwo.');
    expect(seen).toContain('one.\n\nX');
  });

  it('sizes replies by mode', () => {
    const text = 'a'.repeat(700);
    expect(paraphrasePrompt('longer', text).maxTokens!).toBeGreaterThan(paraphrasePrompt('shorter', text).maxTokens!);
    expect(alternativesPrompt('casual', 'Hi there.').prompt).toMatch(/3 different casual/);
  });
});

describe('paraphrasing-tool def', () => {
  it('meets the page rules', () => {
    expect(def.slug).toBe('paraphrasing-tool');
    expect(def.category).toBe('ai');
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
    expect(def.keywords.length).toBeGreaterThanOrEqual(6);
    expect(def.keywords.length).toBeLessThanOrEqual(10);
    expect(def.steps).toHaveLength(3);
    expect(def.faq.at(-1)).toBe(privacyFaq);
    expect(Object.keys(MODES)).toHaveLength(7);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { planSchema, planWithAi, resetAi, validatePlan, wantsPlan } from '@/search/ai/prompt';
import { docs } from './harness';

const shortlist = docs.filter((d) => ['trim-video', 'video-compressor', 'compress-video-to-10mb', 'merge-pdf'].includes(d.slug));

/** a scripted stand-in for Chrome's LanguageModel */
function fake(availability: string, reply: (input: string, opts: { signal?: AbortSignal }) => Promise<string>) {
  const create = vi.fn(async () => {
    const session = { prompt: vi.fn(reply), clone: vi.fn(async () => session), destroy: vi.fn() };
    return session;
  });
  (globalThis as Record<string, unknown>).LanguageModel = { availability: vi.fn(async () => availability), create };
  return create;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).LanguageModel;
  resetAi();
});

describe('Prompt API planning', () => {
  it('turns a request into validated steps', async () => {
    fake('available', async () => JSON.stringify({ steps: [{ tool: 'trim-video', preset: { start: 10 } }, { tool: 'compress-video-to-10mb' }], summary: 'Trim, then shrink for Discord' }));
    expect(await planWithAi('cut 10 s off and make it fit discord', shortlist)).toEqual({
      steps: [{ slug: 'trim-video', preset: { start: 10 } }, { slug: 'compress-video-to-10mb', preset: {} }],
      summary: 'Trim, then shrink for Discord',
    });
  });

  it('never creates a session (no model download) unless the model is already available', async () => {
    for (const a of ['downloadable', 'downloading', 'unavailable']) {
      resetAi();
      const create = fake(a, async () => '{}');
      expect(await planWithAi('anything at all here', shortlist)).toBeNull();
      expect(create).not.toHaveBeenCalled();
    }
  });

  it('returns nothing without the API', async () => {
    expect(await planWithAi('anything', shortlist)).toBeNull();
  });

  it('drops malformed output, unknown tools and preset keys a tool does not take', async () => {
    fake('available', async () => 'not json');
    expect(await planWithAi('q', shortlist)).toBeNull();
    expect(validatePlan(JSON.stringify({ steps: [{ tool: 'rm-rf' }] }), shortlist)).toBeNull();
    expect(validatePlan(JSON.stringify({ steps: [{ tool: 'merge-pdf', preset: { target: '10mb', start: 5 } }], summary: 3 }), shortlist)).toEqual({
      steps: [{ slug: 'merge-pdf', preset: {} }],
      summary: '',
    });
    expect(validatePlan(JSON.stringify({ steps: [{ tool: 'video-compressor', preset: { target: 'huge' } }] }), shortlist)!.steps[0].preset).toEqual({});
  });

  it('gives up after the timeout', async () => {
    fake('available', (_, { signal }) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    expect(await planWithAi('slow one', shortlist, { timeoutMs: 20 })).toBeNull();
  });

  it('constrains the schema to the shortlist', () => {
    const schema = planSchema(shortlist) as { properties: { steps: { items: { properties: { tool: { enum: string[] }; preset: { properties: object } } } } } };
    expect(schema.properties.steps.items.properties.tool.enum.sort()).toEqual(shortlist.map((d) => d.slug).sort());
    expect(Object.keys(schema.properties.steps.items.properties.preset.properties).sort()).toEqual(['end', 'start', 'target']);
  });

  it('plans long or unresolved requests, never Hinglish', () => {
    expect(wantsPlan('compress pdf', true, false)).toBe(false);
    expect(wantsPlan('i need to shrink this video and cut the start', true, false)).toBe(true);
    expect(wantsPlan('xyz', false, false)).toBe(true);
    expect(wantsPlan('video ka size kam karna hai please jaldi', false, true)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { catalog, describe as describeOp, opBySlug, ops, parseOptions, parseSize, resolveTool, RounderError, run, snippets, webLink } from '@roundertools/sdk';

describe('op specs', () => {
  it('every op is a tool page on the site (file-info is the one exception)', () => {
    const slugs = new Set(catalog().map((t) => t.slug));
    for (const op of ops) if (op.slug !== 'file-info') expect(slugs.has(op.slug), op.slug).toBe(true);
  });

  it('slugs and SDK names are unique', () => {
    expect(new Set(ops.map((o) => o.slug)).size).toBe(ops.length);
    expect(new Set(ops.map((o) => `${o.family}.${o.fn}`)).size).toBe(ops.length);
  });

  it.each(ops.map((o) => [o.slug, o] as const))('%s: defaults apply and every example validates', (_, op) => {
    const defaults = op.options.safeParse({});
    // protect-pdf needs a password; everything else runs on defaults
    expect(defaults.success).toBe(op.slug !== 'protect-pdf');
    for (const ex of op.examples) {
      expect(() => parseOptions(op, ex.options ?? {})).not.toThrow();
      expect(ex.inputs.length).toBeGreaterThanOrEqual(op.inputs.min);
      expect(ex.prompt.length).toBeGreaterThan(10);
    }
  });

  it.each(ops.map((o) => [o.slug, o] as const))('%s: has a JSON Schema for MCP and docs snippets', (_, op) => {
    const d = describeOp(op.slug);
    expect(d.options).toMatchObject({ type: 'object' });
    const s = snippets(op);
    expect(s.cli).toMatch(new RegExp(`^npx roundertools ${op.slug} `));
    expect(s.sdk).toContain(`${op.family}.${op.fn}(`);
  });

  it('bad options come back as invalid-options with the reason', async () => {
    const e = await run('compress-pdf', [new Uint8Array([1])], { level: 'extreme' }).catch((x) => x);
    expect(e).toBeInstanceOf(RounderError);
    expect(e.code).toBe('invalid-options');
    expect(e.message).toMatch(/level/);
    expect(() => parseOptions(opBySlug['protect-pdf'], {})).toThrow(/password/);
  });

  it('unknown tools are a usage error', async () => {
    await expect(run('make-coffee', [])).rejects.toMatchObject({ code: 'invalid-options', message: expect.stringMatching(/no tool called/) });
    // a page that only runs in a browser says so, with its address
    await expect(run('heic-to-jpg', [])).rejects.toMatchObject({ code: 'invalid-options', message: expect.stringMatching(/only runs in a browser.*roundertools\.com\/heic-to-jpg/) });
  });
});

describe('variant pages as presets', () => {
  it('maps every variant of an op that has presets to options the op accepts', () => {
    const variants = catalog().filter((t) => t.variantOf && opBySlug[t.variantOf]);
    expect(variants.length).toBeGreaterThan(30);
    for (const v of variants) {
      const tool = resolveTool(v.slug);
      if (!tool) continue;
      expect(tool.spec.slug).toBe(v.variantOf);
      expect(() => parseOptions(tool.spec, tool.preset), v.slug).not.toThrow();
    }
  });

  it("refuses pages the op can't reproduce instead of running the main tool with other settings", () => {
    // a mode the op lacks (increase to a size, centimetres), or an input it can't read (HEIC)
    for (const slug of ['increase-image-size-in-kb', 'resize-image-in-cm', 'jpg-to-pdf-under-200kb', 'heic-to-pdf', 'heic-to-jpg']) expect(resolveTool(slug), slug).toBeNull();
    // pages that only differ by input format still resolve
    expect(resolveTool('mp4-to-mp3')?.spec.slug).toBe('video-to-mp3');
    expect(resolveTool('rotate-pdf')?.spec.slug).toBe('organize-pdf');
  });

  it('reads the presets the pages use', () => {
    expect(resolveTool('png-to-jpg')!.preset).toEqual({ to: 'jpeg' });
    expect(resolveTool('compress-pdf-to-100kb')!.preset).toEqual({ target: '100kb' });
    expect(resolveTool('compress-video-to-25mb')!.preset).toEqual({ target: '25mb' });
    expect(resolveTool('pdf-to-png')!.preset).toEqual({ format: 'png' });
    expect(resolveTool('word-counter')).toBeNull();
  });

  it('links back to the same preset on the site', () => {
    expect(webLink(opBySlug['compress-pdf'], { target: '200kb' })).toBe('https://roundertools.com/compress-pdf#200kb');
    expect(webLink(opBySlug['compress-pdf'], {})).toBe('https://roundertools.com/compress-pdf');
  });
});

describe('parseSize', () => {
  it('reads decimal units like the site, binary units on request', () => {
    expect(parseSize('100kb')).toBe(100_000);
    expect(parseSize('2.5MB')).toBe(2_500_000);
    expect(parseSize('100KiB')).toBe(102_400);
    expect(parseSize('1 gb')).toBe(1e9);
    expect(parseSize(12345)).toBe(12345);
    expect(parseSize('512')).toBe(512);
  });

  it('rejects what is not a size', () => {
    for (const bad of ['', 'big', '-1kb', '0', '1.2.3mb']) expect(() => parseSize(bad), bad).toThrow(RounderError);
  });
});

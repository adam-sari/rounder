import { extname } from 'node:path';
import { z } from 'zod';
import { catalog, SITE } from './catalog';
import { RounderError, toRounderError } from './core/errors';
import { toSource, type FileInput, type Source } from './core/io';
import { acceptsFormat, type OpSpec } from './core/op';
import type { OpResult, RunOptions } from './core/run';
import { opBySlug, ops } from './ops/index';
import { loadCanvas } from './platform/node/canvas';
import { requireFfmpeg } from './platform/node/ffmpeg-bin';

export interface ResolvedTool {
  spec: OpSpec;
  /** the slug asked for: the op's own, or a variant page's (png-to-jpg) */
  slug: string;
  /** options the variant presets, e.g. { to: 'jpeg' } */
  preset: Record<string, unknown>;
}

/** An op slug, or a variant page's slug (png-to-jpg, compress-pdf-to-100kb) with its preset options; null when unknown */
export function resolveTool(slug: string): ResolvedTool | null {
  const spec = opBySlug[slug];
  if (spec) return { spec, slug, preset: {} };
  const entry = catalog().find((t) => t.slug === slug);
  const main = entry?.variantOf ? opBySlug[entry.variantOf] : undefined;
  if (!entry || !main) return null;
  // a page the op can't reproduce (a mode it lacks, like "increase to 50 KB", or an input it can't read, like HEIC)
  // stays browser-only rather than quietly running the main tool with other settings
  const props = entry.props ?? {};
  const preset = main.presets ? main.presets(props) : {};
  if (!preset || !acceptsFormat(main, props)) return null;
  return { spec: main, slug, preset: preset as Record<string, unknown> };
}

/** the error for a slug with no op: a page that only runs in a browser, or nothing at all */
export function unknownTool(slug: string): RounderError {
  if (catalog().some((t) => t.slug === slug)) return new RounderError('invalid-options', `${slug} only runs in a browser for now: ${SITE}/${slug} (files stay on your computer there too).`);
  return new RounderError('invalid-options', `There's no tool called "${slug}". Run \`roundertools list\` to see them all.`);
}

/** zod's issues as one readable line per problem */
export function optionProblems(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`).join('; ');
}

/** validates options against the op's schema, defaults filled in */
export function parseOptions(spec: OpSpec, options: unknown): Record<string, unknown> {
  const parsed = spec.options.safeParse(options ?? {});
  if (!parsed.success) throw new RounderError('invalid-options', `Invalid options for ${spec.slug}: ${optionProblems(parsed.error)}`);
  return parsed.data as Record<string, unknown>;
}

function checkInputs(spec: OpSpec, sources: Source[]) {
  const { min, max, accept } = spec.inputs;
  if (sources.length < min) throw new RounderError('invalid-options', `${spec.slug} needs ${min === 1 ? 'a file' : `at least ${min} files`}.`);
  if (sources.length > max) throw new RounderError('invalid-options', `${spec.slug} takes ${max === 1 ? 'one file at a time' : `at most ${max} files`}.`);
  if (accept.includes('*')) return;
  for (const s of sources) {
    const ext = extname(s.name).slice(1).toLowerCase();
    if (ext && !accept.includes(ext)) throw new RounderError('unsupported-input', `${s.name}: ${spec.slug} takes ${accept.join(', ')} files.`);
  }
}

export function checkRequirements(spec: OpSpec) {
  for (const r of spec.requires ?? []) {
    if (r === 'ffmpeg') requireFfmpeg();
    if (r === 'canvas' && !loadCanvas()) throw new RounderError('missing-dependency', `${spec.slug} needs the optional @napi-rs/canvas package to draw pages.`, { hint: 'npm install @napi-rs/canvas' });
  }
}

/**
 * Runs any op by slug (variant slugs work too): what the CLI and the MCP server call. Inputs are paths, URLs or bytes;
 * options are validated against the op's schema. Every failure is a RounderError.
 */
export async function run(slug: string, inputs: FileInput[], options: Record<string, unknown> = {}, o: RunOptions = {}): Promise<OpResult & { tool: string; web: string }> {
  const tool = resolveTool(slug);
  if (!tool) throw unknownTool(slug);
  const { spec } = tool;
  try {
    const parsed = parseOptions(spec, { ...tool.preset, ...options });
    const sources = await Promise.all(inputs.map((i, k) => toSource(i, `input-${k + 1}`)));
    checkInputs(spec, sources);
    checkRequirements(spec);
    const { impls } = await import('./impl/index');
    const signal = o.signal ?? new AbortController().signal;
    const r = await impls[spec.slug](sources, parsed as never, { signal, progress: (p) => o.onProgress?.(p) });
    return { ...r, tool: spec.slug, web: webLink(spec, parsed) };
  } catch (e) {
    throw toRounderError(e);
  }
}

/** the same tool on the site, with the same preset where the page reads one from its address */
export function webLink(spec: OpSpec, options: Record<string, unknown> = {}): string {
  if (spec.slug === 'file-info') return SITE;
  return `${SITE}/${spec.slug}${spec.deepLink?.(options as never) ?? ''}`;
}

/** Everything a caller needs to know about an op: its schema as JSON Schema, inputs, outputs and an example */
export function describe(slug: string) {
  const tool = resolveTool(slug);
  if (!tool) throw unknownTool(slug);
  const { spec } = tool;
  return {
    slug: spec.slug,
    title: spec.title,
    summary: spec.summary,
    family: spec.family,
    inputs: spec.inputs,
    returns: spec.returns,
    requires: spec.requires ?? [],
    preset: tool.preset,
    options: z.toJSONSchema(spec.options, { io: 'input' }),
    examples: spec.examples,
    web: webLink(spec),
  };
}

export const allOps = ops;

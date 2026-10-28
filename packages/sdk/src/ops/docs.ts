import type { Example, OpSpec } from '../core/op';

/*
 * Docs snippets, generated from the op specs so the site's "Use this in code" block, the CLI's help and the package
 * READMEs can't drift from what the code accepts.
 */

export const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `"${s.replace(/(["\\$`])/g, '\\$1')}"`);

function cliFlag(key: string, value: unknown): string[] {
  const flag = `--${kebab(key)}`;
  if (value === true) return [flag];
  if (value === false) return [`--no-${kebab(key)}`];
  if (Array.isArray(value)) return value.flatMap((v) => [flag, shellQuote(String(v))]);
  return [flag, shellQuote(String(value))];
}

/** `npx roundertools compress-pdf report.pdf --target 1mb` */
export function cliLine(spec: OpSpec, ex: Example<Record<string, unknown>> = spec.examples[0] as Example<Record<string, unknown>>): string {
  const parts = ['npx roundertools', spec.slug, ...ex.inputs.map(shellQuote)];
  for (const [k, v] of Object.entries(ex.options ?? {})) parts.push(...cliFlag(k, v));
  return parts.join(' ');
}

const js = (v: unknown) => (typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : JSON.stringify(v));

/** the SDK call, ready to paste */
export function sdkSnippet(spec: OpSpec, ex: Example<Record<string, unknown>> = spec.examples[0] as Example<Record<string, unknown>>): string {
  const opts = Object.entries(ex.options ?? {});
  const optText = opts.length ? `, { ${opts.map(([k, v]) => `${k}: ${js(v)}`).join(', ')} }` : '';
  const input = spec.inputs.mode === 'all' ? `[${ex.inputs.map(js).join(', ')}]` : js(ex.inputs[0]);
  const call = `${spec.family}.${spec.fn}(${input}${optText})`;
  const lines = [`import { ${spec.family} } from '@roundertools/sdk';`, ''];
  if (spec.returns === 'file') lines.push(`const out = await ${call};`, 'await out.save(); // into the current folder; never replaces an existing file');
  else if (spec.returns === 'files') lines.push(`const outs = await ${call};`, "for (const out of outs) await out.save('out/');");
  else if (spec.returns === 'text') lines.push(`const text = await ${call};`);
  else lines.push(`const info = await ${call};`);
  return lines.join('\n');
}

/** what to ask an assistant that has the MCP server */
export const mcpPrompt = (spec: OpSpec) => spec.examples[0]?.prompt ?? spec.summary;

export interface Snippets {
  cli: string;
  sdk: string;
  prompt: string;
  requires: string[];
}

export const snippets = (spec: OpSpec): Snippets => ({ cli: cliLine(spec), sdk: sdkSnippet(spec), prompt: mcpPrompt(spec), requires: spec.requires ?? [] });

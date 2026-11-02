// The developer docs read the npm packages' own op specs, so the site's snippets can't drift from what the SDK, CLI and
// MCP server accept. Only the specs are imported (zod schemas and text), never the packages' Node code.
import { cliLine, sdkSnippet } from '../packages/sdk/src/ops/docs';
import { opBySlug, ops } from '../packages/sdk/src/ops/index';
import { acceptsFormat, type Example, type OpSpec } from '../packages/sdk/src/core/op';
import type { Tool } from './tools/types';
import {
  DEFAULT_OPTIONS,
  PACKAGES,
  PLUGIN_COMMANDS,
  claudeCodeCommand,
  cursorJson,
  cursorLink,
  installableOps,
  mcpServersJson,
  upFrontTokens,
  vscodeJson,
  vscodeLink,
  type InstallOptions,
  type InstallerOp,
} from './developers/installer';

export { ops };
export type { OpSpec };

/**
 * Whether the packages are on npm. The per-tool "Use this in code" block and the install lines assume they are: set
 * this to false to hide the block if the site ships before the packages do.
 */
export const PACKAGES_ON_NPM = true;

export const NPM = PACKAGES;

/**
 * The tool catalog as plain data for the installer island (the op specs themselves carry zod schemas): the tools an
 * `npx @roundertools/mcp` install can list, so without pdf-to-jpg, which needs the optional @napi-rs/canvas.
 */
export const installerCatalog: InstallerOp[] = installableOps(ops).map((o) => ({ slug: o.slug, family: o.family, title: o.title, ...(o.requires ? { requires: [...o.requires] } : {}) }));

// the docs' example install: lean, reading Documents. Built by the same code as the installer, so the two can't drift
const example: InstallOptions = { ...DEFAULT_OPTIONS, allow: ['~/Documents'] };
export const MCP_INSTALL = {
  claudeCode: claudeCodeCommand(example, installerCatalog),
  claudeCodeAllow: claudeCodeCommand({ ...example, allow: ['~/Documents', '~/Downloads'] }, installerCatalog),
  // the same on Windows: the server expands ~ itself
  claudeDesktop: mcpServersJson(example, installerCatalog),
  cursor: cursorJson(example, installerCatalog),
  vscode: vscodeJson(example, installerCatalog),
};

/** one-click installs: Cursor takes the server config as base64 JSON, VS Code as URL-encoded JSON with the name inside */
export const MCP_INSTALL_LINKS = {
  cursor: cursorLink(example, installerCatalog),
  vscode: vscodeLink(example, installerCatalog),
};

/** the Claude Code plugin in plugins/roundertools: the CLI's skill, no MCP server */
export const CLAUDE_PLUGIN = PLUGIN_COMMANDS.join('\n');

/** what the MCP server's tool list and instructions cost per conversation, in friendly tokens, for the docs' prose */
export const MCP_TOKENS = {
  lean: upFrontTokens(DEFAULT_OPTIONS, installerCatalog),
  all: upFrontTokens({ ...DEFAULT_OPTIONS, preset: 'all' }, installerCatalog),
};

export interface CodeSnippets {
  op: OpSpec;
  cli: string;
  sdk: string;
  prompt: string;
  needs: string[];
}

const NEEDS: Record<string, string> = { ffmpeg: 'ffmpeg on your computer', canvas: 'the optional @napi-rs/canvas package' };

/**
 * The snippets for a tool page: its own op, or for a preset page (png-to-jpg, compress-pdf-to-100kb) the main op with
 * the preset applied. Null when the tool only runs in a browser.
 */
export function snippetsFor(tool: Tool): CodeSnippets | null {
  const op = opBySlug[tool.slug] ?? (tool.variantOf ? opBySlug[tool.variantOf] : undefined);
  if (!op) return null;
  const own = tool.slug === op.slug;
  // the same rule as the SDK's resolveTool: a page the op can't reproduce (a mode it lacks, an input it can't read) shows nothing
  const preset = own ? {} : op.presets ? op.presets(tool.props ?? {}) : {};
  if (!preset || !acceptsFormat(op, tool.props ?? {})) return null;
  // a page with nothing to preset (rotate-pdf, delete-pdf-pages) shows the example that matches its name
  const plain = !own && Object.keys(preset).length === 0;
  const base = (plain ? closestExample(op, tool.name) : op.examples[0]) as Example<Record<string, unknown>>;
  // a preset page about one format gets an example file in that format
  const from = typeof tool.props?.from === 'string' ? tool.props.from.toLowerCase() : undefined;
  const inputs = from ? base.inputs.map((i) => i.replace(/\.[a-z0-9]+$/i, `.${from}`)) : base.inputs;
  const shown = own || plain ? base.options : {};
  const options = { ...shown, ...preset };
  return {
    op,
    cli: cliLine({ ...op, slug: tool.slug }, { ...base, inputs, options: shown }),
    sdk: sdkSnippet(op, { ...base, inputs, options }),
    // a preset page asks for what its name says, e.g. "PNG to JPG: photo.png"
    prompt: own || plain ? base.prompt : `${tool.name}: ${inputs.join(', ')}`,
    needs: (op.requires ?? []).map((r) => NEEDS[r]),
  };
}

/** the op's example whose prompt shares the most words with a page name ("Delete PDF pages" → the delete example) */
function closestExample(op: OpSpec, name: string) {
  const words = new Set(name.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const score = (e: Example<unknown>) => (e.prompt ?? '').toLowerCase().split(/\W+/).filter((w) => words.has(w)).length;
  return op.examples.reduce((best, e) => (score(e) > score(best) ? e : best), op.examples[0]);
}

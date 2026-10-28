import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { catalog, cliLine, ffmpegVersion, findFfmpeg, loadCanvas, opBySlug, ops, resolveTool, unknownTool, version, webLink, type OpSpec } from '@roundertools/sdk';
import { fieldsOf, type Field } from './args';
import type { Io } from './main';

const line = (s: NodeJS.WritableStream, text = '') => s.write(`${text}\n`);

const FAMILY: Record<string, string> = { pdf: 'PDF', image: 'Images', files: 'Files', media: 'Video and audio (needs ffmpeg)' };

export function mainHelp(): string {
  return `roundertools ${version}: Rounder's file tools, on your machine. Files never leave it.

Usage
  roundertools <tool> <files…> [options]    run a tool (the slugs from roundertools.com)
  roundertools list [--json]                every tool the CLI has
  roundertools help <tool>                  a tool's options and examples
  roundertools doctor                       what's installed (ffmpeg, canvas) and working
  roundertools mcp [--allow DIR…]           run the MCP server for AI assistants

Examples
  roundertools compress-pdf report.pdf --target 1mb
  roundertools image-converter "photos/*.png" --to webp -o webp/
  roundertools merge-pdf a.pdf b.pdf -o merged.pdf
  roundertools video-compressor clip.mov --target 25mb

Options for every tool
  -o, --output PATH   a file, or a folder ending in a slash (default: next to each input); "-" for stdout
  --overwrite         replace existing files (inputs are never replaced)
  --json, --ndjson    machine-readable output on stdout
  -r, --recursive     take folders, processing the files inside
  -j, --concurrency N files at a time
  --strict            exit 5 when a size target can't be met
  -q, --quiet         no messages      --verbose   stack traces on errors

Exit codes: 0 ok · 1 failed · 2 usage · 3 some files failed · 4 missing ffmpeg or canvas · 5 target not met (--strict) · 6 password needed or wrong · 130 interrupted
Docs: https://roundertools.com/developers/cli`;
}

export function list(args: string[], io: Io): number {
  const json = args.includes('--json');
  const family = args.includes('--family') ? args[args.indexOf('--family') + 1] : undefined;
  const chosen = ops.filter((o) => !family || o.family === family);
  const variants = (slug: string) => catalog().filter((t) => t.variantOf === slug && resolveTool(t.slug)).map((t) => t.slug);
  if (json) {
    line(io.stdout, JSON.stringify(chosen.map((o) => ({ slug: o.slug, title: o.title, family: o.family, summary: o.summary, requires: o.requires ?? [], aliases: variants(o.slug), web: webLink(o) }))));
    return 0;
  }
  for (const fam of ['pdf', 'image', 'files', 'media']) {
    const group = chosen.filter((o) => o.family === fam);
    if (!group.length) continue;
    line(io.stdout, FAMILY[fam]);
    for (const o of group) line(io.stdout, `  ${o.slug.padEnd(26)} ${o.summary}`);
    line(io.stdout);
  }
  const aliasCount = chosen.reduce((n, o) => n + variants(o.slug).length, 0);
  line(io.stdout, `Plus ${aliasCount} preset names from the site (png-to-jpg, compress-pdf-to-100kb, mov-to-mp4…). \`roundertools help <tool>\` lists them.`);
  return 0;
}

function typeText(f: Field) {
  if (f.kind === 'boolean') return '';
  if (f.numeric && f.text && !f.choices) return /^(start|end)$/.test(f.key) ? ' <TIME>' : ' <SIZE>';
  const base = f.choices ? f.choices.join('|') + (f.numeric && f.choices.some((c) => typeof c === 'string') && !f.choices.every((c) => typeof c === 'number') ? '|N' : '') : f.kind === 'number' ? 'N' : f.kind === 'list' ? 'A,B' : 'TEXT';
  return ` <${base}>`;
}

export function help(slug: string, io: Io): number {
  const tool = resolveTool(slug);
  if (!tool) {
    line(io.stderr, unknownTool(slug).message);
    return 2;
  }
  const spec: OpSpec = tool.spec;
  const { min, max, accept, mode } = spec.inputs;
  const many = max > 1 ? (mode === 'all' ? ' (all of them go into one result)' : '') : '';
  line(io.stdout, `${spec.slug}: ${spec.title}`);
  line(io.stdout, spec.summary);
  if (slug !== spec.slug) line(io.stdout, `\n${slug} is ${spec.slug} with ${JSON.stringify(tool.preset)}.`);
  line(io.stdout, `\nUsage\n  roundertools ${slug} <${accept.includes('*') ? 'file' : accept.join('|')}>${min > 1 || max > 1 ? '…' : ''} [options]${many}`);
  if (spec.requires?.length) line(io.stdout, `  Needs: ${spec.requires.map((r) => (r === 'ffmpeg' ? 'ffmpeg (on PATH or ROUNDERTOOLS_FFMPEG)' : '@napi-rs/canvas (npm install @napi-rs/canvas)')).join(', ')}`);
  line(io.stdout, '\nOptions');
  for (const f of fieldsOf(spec)) {
    const short = spec.short?.[f.key as keyof typeof spec.short];
    const flag = `${short ? `-${short}, ` : ''}--${f.flag}${typeText(f)}`;
    const def = f.default !== undefined && f.kind !== 'boolean' ? ` (default ${Array.isArray(f.default) ? f.default.join(',') : f.default})` : f.default === true ? ' (on by default; --no-' + f.flag + ' turns it off)' : '';
    line(io.stdout, `  ${flag.padEnd(34)} ${f.description ?? ''}${def}${f.required ? ' (required)' : ''}`);
  }
  line(io.stdout, '\nExamples');
  for (const ex of spec.examples) line(io.stdout, `  ${cliLine(spec, ex as never).replace(/^npx /, '')}`);
  const aliases = catalog().filter((t) => t.variantOf === spec.slug && resolveTool(t.slug)).map((t) => t.slug);
  if (aliases.length) line(io.stdout, `\nPreset names: ${aliases.join(', ')}`);
  line(io.stdout, `\nOn the web: ${webLink(spec, tool.preset)}`);
  return 0;
}

export function doctor(args: string[], io: Io): number {
  const json = args.includes('--json');
  const require = createRequire(import.meta.url);
  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  const nodeOk = major > 22 || (major === 22 && minor >= 13);
  const ff = findFfmpeg();
  let tmpOk = true;
  try {
    accessSync(tmpdir(), constants.W_OK);
  } catch {
    tmpOk = false;
  }
  let mcp: string | null = null;
  try {
    mcp = (require('@roundertools/mcp/package.json') as { version: string }).version;
  } catch {
    // not installed
  }
  const report = {
    version,
    node: { version: process.versions.node, ok: nodeOk },
    ffmpeg: ff ? { path: ff, version: ffmpegVersion() } : null,
    canvas: !!loadCanvas(),
    mcp,
    tmp: { dir: tmpdir(), writable: tmpOk },
    ops: ops.length,
    media: ops.filter((o) => o.requires?.includes('ffmpeg')).map((o) => o.slug),
  };
  if (json) {
    line(io.stdout, JSON.stringify(report));
    return nodeOk ? 0 : 1;
  }
  const mark = (ok: boolean) => (ok ? 'ok ' : '-- ');
  line(io.stdout, `roundertools ${version}`);
  line(io.stdout, `${mark(nodeOk)} Node ${process.versions.node}${nodeOk ? '' : ' (needs 22.13 or newer)'}`);
  line(io.stdout, `${mark(!!ff)} ffmpeg ${ff ? `${report.ffmpeg!.version ?? ''} at ${ff}` : 'not found: video and audio tools need it (https://ffmpeg.org/download.html, or set ROUNDERTOOLS_FFMPEG)'}`);
  line(io.stdout, `${mark(report.canvas)} @napi-rs/canvas ${report.canvas ? 'installed: pdf-to-jpg and GIF/BMP/SVG input work' : 'not installed: optional, for pdf-to-jpg and GIF/BMP/SVG input (npm install @napi-rs/canvas)'}`);
  line(io.stdout, `${mark(!!mcp)} MCP server ${mcp ? `@roundertools/mcp ${mcp}` : 'not installed (run it with npx -y @roundertools/mcp)'}`);
  line(io.stdout, `${mark(tmpOk)} temp folder ${tmpdir()}`);
  line(io.stdout, `${opBySlug['compress-pdf'] ? ops.length : 0} tools available. Network: none; files stay on this machine.`);
  return nodeOk ? 0 : 1;
}

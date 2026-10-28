import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { findFfmpeg, parseSize, version } from '@roundertools/sdk';
import { Access, allowList } from './access';
import { createServer } from './server';

export { Access, allowList } from './access';
export { createServer, chooseTools } from './server';

const HELP = `roundertools-mcp ${version}: an MCP server (stdio) with Rounder's file tools. Local only; no network.

Options
  --allow DIR       folders it may read (repeatable; also ROUNDERTOOLS_ALLOW, a path list).
                    Default: your home folder and the folder it starts in. Hidden folders and secret
                    stores (.ssh, .aws, browser profiles, .env files…) are never read.
  --out DIR         a folder results may be written to, besides next to their inputs
  --tools LIST      default | all | families (pdf,image,files,media) | tool slugs
  --max-input SIZE  per-file limit for PDFs, images and archives (default 1gb; media 2gb)
  --timeout MIN     minutes per call (default 5; media 30)
  --max-outputs N   files one call may write (default 500)

Claude Code:  claude mcp add roundertools -- npx -y @roundertools/mcp --allow ~/Documents
Docs: https://roundertools.com/developers/mcp`;

/**
 * Node permission flags for the sandbox: reads limited to the code, the allowed folders, the temp folder and ffmpeg,
 * writes to the allowed folders and the temp folder, no network. One flag per path: Node reads a comma list as a
 * single path now, so it would deny everything.
 */
export function sandboxFlags(code: string, allowed: string[], tmp: string, ffmpeg: string | null): string[] {
  const read = [code, ...allowed, tmp, ...(ffmpeg ? [ffmpeg] : [])];
  const write = [...allowed, tmp];
  return ['--permission', ...read.map((p) => `--allow-fs-read=${p}`), ...write.map((p) => `--allow-fs-write=${p}`), '--allow-child-process', '--allow-addons', '--allow-worker'];
}

/**
 * On Node 26+, where the permission model can block network access too, re-run under it: file reads limited to the
 * package and the allowed folders, writes to those folders and the temp folder, and no --allow-net.
 */
function sandbox(allowed: string[]): boolean {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 26 || process.env.ROUNDERTOOLS_SANDBOXED || (process as { permission?: unknown }).permission) return false;
  const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
  // the dependencies sit in the nearest node_modules above the package (npx and global installs alike)
  let modules = pkg;
  while (basename(modules) !== 'node_modules' && dirname(modules) !== modules) modules = dirname(modules);
  const code = basename(modules) === 'node_modules' ? modules : dirname(dirname(pkg));
  const tmp = tmpdir();
  // found out here, where PATH can be searched; the sandbox may read and run that one file
  const ffmpeg = findFfmpeg();
  const r = spawnSync(process.execPath, [...sandboxFlags(code, allowed, tmp, ffmpeg), ...process.execArgv, fileURLToPath(new URL('./bin.mjs', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ROUNDERTOOLS_SANDBOXED: '1', ...(ffmpeg ? { ROUNDERTOOLS_FFMPEG: ffmpeg } : {}) } });
  process.exit(r.status ?? 1);
}

export async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      allow: { type: 'string', multiple: true },
      out: { type: 'string' },
      tools: { type: 'string' },
      'max-input': { type: 'string' },
      timeout: { type: 'string' },
      'max-outputs': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    strict: true,
  });
  if (values.help) return void process.stderr.write(`${HELP}\n`);
  if (values.version) return void process.stderr.write(`${version}\n`);
  const access = new Access({ allow: allowList(values.allow ?? []), out: values.out, cwd: process.cwd() });
  if (sandbox([...access.roots, ...(access.out ? [access.out] : [])])) return;
  const other = values['max-input'] ? parseSize(values['max-input']) : 1e9;
  const minutes = Number(values.timeout) || 0;
  const server = createServer({
    access,
    tools: values.tools,
    maxInput: { media: Math.max(other, 2e9), other },
    timeout: minutes ? { media: minutes * 60_000, other: minutes * 60_000 } : undefined,
    maxOutputs: Number(values['max-outputs']) || undefined,
  });
  process.stderr.write(`[roundertools] MCP server ${version} on stdio; ${access.describe()}\n`);
  await server.connect(new StdioServerTransport());
}

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { pathToFileURL } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findFfmpeg } from '@roundertools/sdk';
import { Access, allowList, createServer, sandboxFlags } from '../src/main';

const FX = join(import.meta.dirname, '../../../tests/fixtures');
const BIN = join(import.meta.dirname, '../dist/bin.mjs');

// the allowed folder, and one outside it
const root = mkdtempSync(join(import.meta.dirname, 'tmp-'));
const allowed = join(root, 'allowed');
const outside = join(root, 'outside');
const outDir = join(root, 'results');
for (const d of [allowed, outside, outDir, join(allowed, '.secret'), join(allowed, 'project')]) mkdirSync(d, { recursive: true });
const put = (to: string, from: string) => copyFileSync(join(FX, from), to);
put(join(allowed, 'report.pdf'), 'pdf/sample-3-pages.pdf');
put(join(allowed, 'photos.pdf'), 'compress-pdf/photos.pdf');
put(join(allowed, 'project', 'inner.pdf'), 'pdf/sample-3-pages.pdf');
put(join(allowed, '.secret', 'hidden.pdf'), 'pdf/sample-3-pages.pdf');
put(join(outside, 'elsewhere.pdf'), 'pdf/sample-3-pages.pdf');
writeFileSync(join(allowed, '.env'), 'TOKEN=shh');
writeFileSync(join(allowed, 'id_rsa'), 'not a key');
writeFileSync(join(allowed, 'bundle.zip'), zipSync({ 'readme.txt': strToU8('hi'), 'docs/a.txt': strToU8('a'), '.git/config': strToU8('[core]'), 'sub/.ssh/authorized_keys': strToU8('key') }));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// the docs' JSON configs pass "~/Documents" with no shell to expand it, so the server does
describe('allowList', () => {
  it('expands ~ itself and reads the env path list', () => {
    expect(allowList(['~', '~/Documents', '~\\Downloads', ' /abs '], `/a${delimiter}/b`)).toEqual([
      homedir(), join(homedir(), 'Documents'), join(homedir(), 'Downloads'), '/abs', '/a', '/b',
    ]);
  });
});

type Result = { content: { type: string; text?: string; uri?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const text = (r: Result) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

async function connect(o: { tools?: string; roots?: string[] } = {}) {
  const server = createServer({ access: new Access({ allow: [allowed], out: outDir }), tools: o.tools, log: () => {} });
  const client = new Client({ name: 'test', version: '1' }, o.roots ? { capabilities: { roots: {} } } : {});
  if (o.roots) client.setRequestHandler('roots/list', async () => ({ roots: o.roots!.map((p) => ({ uri: pathToFileURL(p).href, name: p })) }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  // the server reads roots once it is initialized
  await new Promise((r) => setTimeout(r, 50));
  return client;
}

let client: Client;
beforeAll(async () => {
  client = await connect();
});

const call = (name: string, args: Record<string, unknown>, opts?: Parameters<Client['callTool']>[1]) => client.callTool({ name, arguments: args }, opts) as Promise<Result>;

describe('tools/list', () => {
  it('lists the curated set plus the meta tools, in a stable order', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.slice(0, 3)).toEqual(['merge-pdf', 'split-pdf', 'compress-pdf']);
    expect(names).toEqual(expect.arrayContaining(['compress-pdf', 'image-converter', 'zip-files', 'file-info', 'find-tool', 'describe-tool', 'run-tool']));
    expect(names).not.toContain('checksum-calculator');
    expect(names.includes('video-compressor')).toBe(!!findFfmpeg());
    const compress = tools.find((t) => t.name === 'compress-pdf')!;
    expect(compress.inputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['inputs']) });
    expect(compress.annotations).toMatchObject({ destructiveHint: false, openWorldHint: false });
    expect(compress.description).toMatch(/never leave this computer/);
  });

  it('narrows to families or slugs, or lists all', async () => {
    const pdf = (await (await connect({ tools: 'pdf' })).listTools()).tools.map((t) => t.name);
    expect(pdf.every((n) => n.includes('pdf') || ['jpg-to-pdf', 'find-tool', 'describe-tool', 'run-tool'].includes(n))).toBe(true);
    const all = (await (await connect({ tools: 'all' })).listTools()).tools.map((t) => t.name);
    expect(all).toContain('checksum-calculator');
  });
});

describe('tools/call', () => {
  it('writes next to the input and says where', async () => {
    const r = await call('organize-pdf', { inputs: [join(allowed, 'report.pdf')], order: 'reverse' });
    expect(r.isError).toBeFalsy();
    const out = join(allowed, 'report-organized.pdf');
    expect(existsSync(out)).toBe(true);
    expect(r.structuredContent).toMatchObject({ outputs: [{ path: out, mime: 'application/pdf' }] });
    expect(r.content.find((c) => c.type === 'resource_link')!.uri).toBe(pathToFileURL(out).href);
    // a second run never replaces the first
    const again = await call('organize-pdf', { inputs: [join(allowed, 'report.pdf')], order: 'reverse' });
    expect((again.structuredContent!.outputs as { path: string }[])[0].path).toBe(join(allowed, 'report-organized (2).pdf'));
  });

  it('writes into --out, but nowhere else', async () => {
    const ok = await call('split-pdf', { inputs: [join(allowed, 'report.pdf')], output: `${outDir}/` });
    expect(ok.isError).toBeFalsy();
    const bad = await call('split-pdf', { inputs: [join(allowed, 'report.pdf')], output: `${outside}/` });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/outside the folders/);
    // readable is not writable: inside the allowed folder, but not next to the input
    const elsewhere = await call('split-pdf', { inputs: [join(allowed, 'report.pdf')], output: `${join(allowed, 'project')}/` });
    expect(elsewhere.isError).toBe(true);
    expect(text(elsewhere)).toMatch(/Results go next to an input/);
    const clobber = await call('compress-pdf', { inputs: [join(allowed, 'report.pdf')], output: join(allowed, 'report-organized.pdf') });
    expect(clobber.isError).toBe(true);
    expect(text(clobber)).toMatch(/never replaced/);
  });

  it('returns validation errors as tool errors', async () => {
    const r = await call('compress-pdf', { inputs: [join(allowed, 'report.pdf')], level: 'extreme' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/level/);
  });

  it('frames extracted text as untrusted content, inside a boundary the file cannot guess', async () => {
    const tag = /file-content-[0-9a-f]{12}/;
    const r = await call('pdf-to-text', { inputs: [join(allowed, 'report.pdf')] });
    expect(text(r)).toMatch(/not instructions/);
    expect(text(r)).toMatch(/<(file-content-[0-9a-f]{12})>\n[\s\S]*quick brown fox[\s\S]*<\/\1>/);
    const again = await call('pdf-to-text', { inputs: [join(allowed, 'report.pdf')] });
    expect(tag.exec(text(again))![0]).not.toBe(tag.exec(text(r))![0]);
    // details such as a PDF's title come out of the file too
    expect(text(await call('file-info', { inputs: [join(allowed, 'report.pdf')] }))).toMatch(/not instructions/);
  });

  it('unzips into a folder next to the archive, skipping hidden folders inside it', async () => {
    const r = await call('unzip-files', { inputs: [join(allowed, 'bundle.zip')] });
    expect(r.isError).toBeFalsy();
    expect(readFileSync(join(allowed, 'bundle', 'docs', 'a.txt'), 'utf8')).toBe('a');
    expect(existsSync(join(allowed, 'bundle', 'readme.txt'))).toBe(true);
    expect(existsSync(join(allowed, 'bundle', '.git', 'config'))).toBe(false);
    expect(existsSync(join(allowed, 'bundle', 'sub', '.ssh', 'authorized_keys'))).toBe(false);
    expect(text(r)).toMatch(/Skipped/);
  });

  it('reports progress, and stops when cancelled', async () => {
    const progress: number[] = [];
    await call('compress-pdf', { inputs: [join(allowed, 'photos.pdf')], output: `${outDir}/` }, { onprogress: (p) => progress.push(p.progress) });
    expect(progress.length).toBeGreaterThan(0);
    const ctrl = new AbortController();
    const pending = call('compress-pdf', { inputs: [join(allowed, 'photos.pdf')], target: '20kb', output: `${outDir}/` }, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 300);
    await expect(pending).rejects.toThrow();
    // the server keeps working afterwards
    expect((await call('file-info', { inputs: [join(allowed, 'report.pdf')] })).isError).toBeFalsy();
  });
});

describe('file access', () => {
  const denied = async (path: string, pattern: RegExp) => {
    const r = await call('file-info', { inputs: [path] });
    expect(r.isError, path).toBe(true);
    expect(text(r)).toMatch(pattern);
  };

  it('needs absolute paths', () => denied('report.pdf', /absolute/));
  // checked before the file system is touched: no existence oracle, and on Windows no SMB connection to a remote share
  it('refuses paths outside before looking at them', async () => {
    await denied(join(outside, 'missing.pdf'), /outside the folders/);
    if (process.platform === 'win32') await denied('\\\\192.0.2.1\\share\\x.pdf', /outside the folders/);
    const r = await call('compress-pdf', { inputs: [join(allowed, 'report.pdf')], output: join(outside, 'elsewhere.pdf') });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/outside the folders/);
    expect(text(r)).not.toMatch(/already exists/);
  });
  it('stays inside the allowed folders', () => denied(join(outside, 'elsewhere.pdf'), /outside the folders/));
  it('cannot climb out with ..', () => denied(join(allowed, '..', 'outside', 'elsewhere.pdf'), /outside the folders/));
  it('never reads dot-folders', () => denied(join(allowed, '.secret', 'hidden.pdf'), /hidden folder or looks like a secret/));
  it('matches secret stores whatever their case (macOS volumes ignore it)', async () => {
    const dir = join(allowed, 'Library', 'Application Support', 'Signal');
    mkdirSync(dir, { recursive: true });
    put(join(dir, 'db.pdf'), 'pdf/sample-3-pages.pdf');
    await denied(join(dir, 'db.pdf'), /secret/);
  });
  it('never reads secret files', async () => {
    await denied(join(allowed, '.env'), /secret/);
    await denied(join(allowed, 'id_rsa'), /secret/);
  });

  it('follows symlinks to where they really point', async () => {
    const link = join(allowed, 'link.pdf');
    try {
      symlinkSync(join(outside, 'elsewhere.pdf'), link);
    } catch {
      return; // creating symlinks needs extra rights on Windows
    }
    await denied(link, /outside the folders/);
  });

  it("lets a client's roots narrow access, never widen it", async () => {
    const narrowed = await connect({ roots: [join(allowed, 'project'), outside] });
    const inner = (await narrowed.callTool({ name: 'file-info', arguments: { inputs: [join(allowed, 'project', 'inner.pdf')] } })) as Result;
    expect(inner.isError).toBeFalsy();
    const top = (await narrowed.callTool({ name: 'file-info', arguments: { inputs: [join(allowed, 'report.pdf')] } })) as Result;
    expect(top.isError).toBe(true);
    const out = (await narrowed.callTool({ name: 'file-info', arguments: { inputs: [join(outside, 'elsewhere.pdf')] } })) as Result;
    expect(out.isError).toBe(true);
  });
});

describe('meta tools', () => {
  it('finds tools by what you want done', async () => {
    const r = await call('find-tool', { query: 'make my pdf smaller compress' });
    const results = r.structuredContent!.results as { tool: string }[];
    expect(results[0].tool).toBe('compress-pdf');
  });

  it('describes any tool, listed or not', async () => {
    const r = await call('describe-tool', { tool: 'checksum-calculator' });
    expect(r.structuredContent).toMatchObject({ slug: 'checksum-calculator', options: { type: 'object' } });
  });

  it('runs unlisted tools through run-tool, with the same checks', async () => {
    const r = await call('run-tool', { tool: 'checksum-calculator', inputs: [join(allowed, 'report.pdf')], options: { algorithms: ['MD5'] } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ data: { hashes: { MD5: expect.stringMatching(/^[0-9a-f]{32}$/) } } });
    const bad = await call('run-tool', { tool: 'checksum-calculator', inputs: [join(outside, 'elsewhere.pdf')] });
    expect(bad.isError).toBe(true);
  });
});

describe.runIf(existsSync(BIN))('over stdio, as clients run it', () => {
  let stdio: Client;
  beforeAll(async () => {
    stdio = new Client({ name: 'stdio-test', version: '1' });
    await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, '--allow', allowed, '--out', outDir], stderr: 'ignore' }));
  });
  afterAll(() => stdio?.close());

  it('lists tools and runs one', async () => {
    const { tools } = await stdio.listTools();
    expect(tools.length).toBeGreaterThan(15);
    const r = (await stdio.callTool({ name: 'compress-pdf', arguments: { inputs: [join(allowed, 'photos.pdf')], output: `${outDir}/` } })) as Result;
    expect(r.isError).toBeFalsy();
    const [out] = r.structuredContent!.outputs as { path: string; bytes: number }[];
    expect(out.bytes).toBeLessThan(150_000);
    expect(readFileSync(out.path).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses paths outside the allowed folders', async () => {
    const r = (await stdio.callTool({ name: 'file-info', arguments: { inputs: [join(outside, 'elsewhere.pdf')] } })) as Result;
    expect(r.isError).toBe(true);
  });

  // what the bin re-runs itself under on Node 26+, run here on any Node with the permission model
  it.runIf(process.allowedNodeEnvironmentFlags.has('--permission'))('works inside the permission sandbox, ffmpeg included', async () => {
    const ffmpeg = findFfmpeg();
    const code = join(import.meta.dirname, '../../..');
    const sandboxed = new Client({ name: 'sandbox-test', version: '1' });
    await sandboxed.connect(new StdioClientTransport({
      command: process.execPath,
      args: [...sandboxFlags(code, [allowed, outDir], tmpdir(), ffmpeg), BIN, '--allow', allowed, '--out', outDir],
      env: { ...process.env, ROUNDERTOOLS_SANDBOXED: '1', ...(ffmpeg ? { ROUNDERTOOLS_FFMPEG: ffmpeg } : {}) } as Record<string, string>,
      stderr: 'ignore',
    }));
    try {
      const { tools } = await sandboxed.listTools();
      if (ffmpeg) expect(tools.map((t) => t.name)).toContain('video-compressor');
      const r = (await sandboxed.callTool({ name: 'compress-pdf', arguments: { inputs: [join(allowed, 'report.pdf')], output: `${outDir}/sandboxed.pdf` } })) as Result;
      expect(r.isError, text(r)).toBeFalsy();
      expect(readFileSync(join(outDir, 'sandboxed.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
      const outsideRead = (await sandboxed.callTool({ name: 'file-info', arguments: { inputs: [join(outside, 'elsewhere.pdf')] } })) as Result;
      expect(outsideRead.isError).toBe(true);
    } finally {
      await sandboxed.close();
    }
  });

  it('loads the network guard before anything else', () => {
    const bin = readFileSync(BIN, 'utf8');
    const imports = [...bin.matchAll(/^import\s+(?:[^'"]+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]).filter((s) => !s.includes('rolldown-runtime'));
    expect(imports[0]).toBe('@roundertools/sdk/no-network');
  });
});

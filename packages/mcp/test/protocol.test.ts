import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { pathToFileURL } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findFfmpeg, writeSettings } from '@roundertools/sdk';
import { Access, allowList, chooseTools, createServer, sandboxFlags } from '../src/main';

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

// settings and usage memory go to a folder of the test's own, never the real one
const config = join(root, 'config');
process.env.ROUNDERTOOLS_CONFIG_DIR = config;
delete process.env.ROUNDERTOOLS_MEMORY;
const forget = () => rmSync(config, { recursive: true, force: true });
const usageFile = (dir = config) => readFileSync(join(dir, 'usage.json'), 'utf8');
const HELPERS = ['find-tool', 'describe-tool', 'run-tool'];

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

async function connect(o: { tools?: string; roots?: string[]; memory?: boolean; name?: string } = {}) {
  const server = createServer({ access: new Access({ allow: [allowed], out: outDir }), tools: o.tools, memory: o.memory, log: () => {} });
  const client = new Client({ name: o.name ?? 'test', version: '1' }, o.roots ? { capabilities: { roots: {} } } : {});
  if (o.roots) client.setRequestHandler('roots/list', async () => ({ roots: o.roots!.map((p) => ({ uri: pathToFileURL(p).href, name: p })) }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  // the server reads roots once it is initialized
  await new Promise((r) => setTimeout(r, 50));
  return client;
}

// most tests call tools directly, so this client gets the full 0.1 set listed, and remembers nothing
let client: Client;
beforeAll(async () => {
  client = await connect({ tools: 'default', memory: false });
});

/** counts notifications/tools/list_changed; next() resolves on the next one */
function listChanged(c: Client) {
  let seen = 0;
  const waiting: (() => void)[] = [];
  c.setNotificationHandler('notifications/tools/list_changed', () => {
    seen++;
    waiting.splice(0).forEach((resolve) => resolve());
  });
  return { count: () => seen, next: () => new Promise<void>((resolve) => waiting.push(resolve)) };
}
const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name);
const pause = (ms = 50) => new Promise((r) => setTimeout(r, ms));

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

describe('lean by default', () => {
  it('lists only find-tool, describe-tool and run-tool', async () => {
    forget();
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(HELPERS);
    // the point of lean: a few KB of definitions, not ~55
    expect(JSON.stringify(tools).length).toBeLessThan(4_000);
    // find-tool says what the server covers, so an agent knows when to search it
    expect(tools[0].description).toMatch(/PDFs \(merge, split, compress/);
    expect(tools[0].description).toMatch(/video or audio with ffmpeg/);
  });

  it('lists a tool once run-tool runs it, with a list_changed notification', async () => {
    const c = await connect({ memory: false });
    const changes = listChanged(c);
    const changed = changes.next();
    const r = (await c.callTool({ name: 'run-tool', arguments: { tool: 'file-info', inputs: [join(allowed, 'report.pdf')] } })) as Result;
    expect(r.isError, text(r)).toBeFalsy();
    await changed;
    expect(await names(c)).toEqual(['file-info', ...HELPERS]);
    // and it can be called directly now
    expect(((await c.callTool({ name: 'file-info', arguments: { inputs: [join(allowed, 'report.pdf')] } })) as Result).isError).toBeFalsy();
    // running it again changes nothing
    const before = changes.count();
    await c.callTool({ name: 'run-tool', arguments: { tool: 'file-info', inputs: [join(allowed, 'report.pdf')] } });
    await pause();
    expect(changes.count()).toBe(before);
  });

  it('lists a tool once describe-tool describes it (presets too), but not on find-tool', async () => {
    const c = await connect({ memory: false });
    const changes = listChanged(c);
    await c.callTool({ name: 'find-tool', arguments: { query: 'compress pdf' } });
    await pause();
    expect(changes.count()).toBe(0);
    expect(await names(c)).toEqual(HELPERS);
    const changed = changes.next();
    await c.callTool({ name: 'describe-tool', arguments: { tool: 'png-to-jpg' } });
    await changed;
    expect(await names(c)).toEqual(['image-converter', ...HELPERS]);
    // a client may not re-read the list, so find-tool still points at run-tool for a tool listed later
    const found = (await c.callTool({ name: 'find-tool', arguments: { query: 'png to jpg' } })) as Result;
    expect((found.structuredContent!.results as { tool: string }[]).find((h) => h.tool === 'image-converter')).toMatchObject({ listed: false, call: 'run-tool' });
  });

  it('lists nothing new when a run-tool call fails', async () => {
    const c = await connect({ memory: false });
    const changes = listChanged(c);
    const bad = (await c.callTool({ name: 'run-tool', arguments: { tool: 'compress-pdf', inputs: [join(allowed, 'report.pdf')], options: { level: 'bogus' } } })) as Result;
    expect(bad.isError).toBe(true);
    const wrongType = (await c.callTool({ name: 'run-tool', arguments: { tool: 'jpg-to-pdf', inputs: [join(allowed, 'report.pdf')] } })) as Result;
    expect(wrongType.isError).toBe(true);
    const refused = (await c.callTool({ name: 'run-tool', arguments: { tool: 'file-info', inputs: [join(outside, 'elsewhere.pdf')] } })) as Result;
    expect(refused.isError).toBe(true);
    await pause();
    expect(changes.count()).toBe(0);
    expect(await names(c)).toEqual(HELPERS);
  });

  it('gives each find-tool hit the call to make, preset options included', async () => {
    const lean = await connect({ memory: false });
    const results = ((await lean.callTool({ name: 'find-tool', arguments: { query: 'png to jpg' } })) as Result).structuredContent!.results as Record<string, unknown>[];
    expect(results.find((h) => h.tool === 'image-converter')).toMatchObject({ call: 'run-tool', example: { tool: 'image-converter', inputs: ['<absolute path>'], options: { to: 'jpeg' } } });
    const merge = ((await lean.callTool({ name: 'find-tool', arguments: { query: 'merge pdf' } })) as Result).structuredContent!.results as Record<string, unknown>[];
    expect(merge.find((h) => h.tool === 'merge-pdf')).toMatchObject({ example: { inputs: ['<absolute path 1>', '<absolute path 2>'] } });
    const full = ((await client.callTool({ name: 'find-tool', arguments: { query: 'png to jpg' } })) as Result).structuredContent!.results as Record<string, unknown>[];
    expect(full.find((h) => h.tool === 'image-converter')).toMatchObject({ listed: true, call: 'image-converter', example: { inputs: ['<absolute path>'], to: 'jpeg' } });
  });

  it('says how much is listed in its instructions', async () => {
    forget();
    expect((await connect({ memory: false })).getInstructions()).toMatch(/Only a few tools are listed up front/);
    expect(client.getInstructions()).toMatch(/Some tools aren't listed up front/);
    const all = (await connect({ tools: 'all', memory: false })).getInstructions()!;
    expect(all).not.toMatch(/aren't listed|few tools/);
  });

  it('reaches tools that are not listed yet through run-tool only', async () => {
    const c = await connect({ memory: false });
    await expect(c.callTool({ name: 'compress-pdf', arguments: { inputs: [join(allowed, 'report.pdf')] } })).rejects.toThrow(/disabled/);
  });

  it('--tools all lists every tool this computer can run', async () => {
    const all = await names(await connect({ tools: 'all', memory: false }));
    expect(all).toEqual([...chooseTools('all').map((o) => o.slug), ...HELPERS]);
    expect(all).toContain('checksum-calculator');
  });

  it('reads --tools words in any case, and combines all and default with the rest', () => {
    const slugs = (choice: string) => chooseTools(choice).map((o) => o.slug);
    expect(slugs('ALL')).toEqual(slugs('all'));
    expect(slugs('all,pdf')).toEqual(slugs('all'));
    expect(slugs(' Default ')).toEqual(slugs('default'));
    expect(slugs('default,checksum-calculator')).toEqual(slugs('all'));
    expect(slugs('PDF')).toEqual(slugs('pdf'));
    expect(slugs('nonsense')).toEqual([]);
  });

  it('takes --tools from the settings file, and the flag over it', async () => {
    forget();
    writeSettings({ tools: 'files' });
    expect(await names(await connect({ memory: false }))).toEqual(['zip-files', 'unzip-files', 'checksum-calculator', 'file-info', ...HELPERS]);
    expect(await names(await connect({ tools: 'lean', memory: false }))).toEqual(HELPERS);
    forget();
  });
});

describe('usage memory', () => {
  it('lists the tools you use: after two runs, a new server lists it up front', async () => {
    forget();
    const c = await connect();
    for (let i = 0; i < 2; i++) expect(((await c.callTool({ name: 'run-tool', arguments: { tool: 'file-info', inputs: [join(allowed, 'report.pdf')] } })) as Result).isError).toBeFalsy();
    // a failed run isn't counted
    await c.callTool({ name: 'run-tool', arguments: { tool: 'compress-pdf', inputs: [join(outside, 'elsewhere.pdf')] } });
    expect(await names(await connect())).toEqual(['file-info', ...HELPERS]);
    // --no-memory neither lists nor records them
    const off = await connect({ memory: false });
    expect(await names(off)).toEqual(HELPERS);
    await off.callTool({ name: 'run-tool', arguments: { tool: 'file-info', inputs: [join(allowed, 'report.pdf')] } });
    expect(JSON.parse(usageFile()).tools).toEqual({ 'file-info': expect.objectContaining({ count: 2 }) });
  });

  it('stores tool slugs, counts and dates only: no paths, file names or options', () => {
    const raw = usageFile();
    expect(JSON.parse(raw)).toEqual({ version: 1, tools: { 'file-info': { count: 2, last: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } } });
    for (const s of ['report', '.pdf', 'allowed', root, '/', '\\']) expect(raw).not.toContain(s);
  });

  it('is off with ROUNDERTOOLS_MEMORY=off', async () => {
    forget();
    process.env.ROUNDERTOOLS_MEMORY = 'off';
    try {
      const c = await connect();
      await c.callTool({ name: 'run-tool', arguments: { tool: 'file-info', inputs: [join(allowed, 'report.pdf')] } });
      expect(existsSync(join(config, 'usage.json'))).toBe(false);
    } finally {
      delete process.env.ROUNDERTOOLS_MEMORY;
    }
  });
});

describe('prompts', () => {
  it('lists the prompts', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['compress-pdf', 'merge-pdfs', 'convert-images', 'pdf-to-text', ...(findFfmpeg() ? ['shrink-video'] : [])]);
    expect(prompts[0].arguments).toEqual([expect.objectContaining({ name: 'file', required: true }), expect.objectContaining({ name: 'size', required: false })]);
  });

  it('names the exact call: the tool when it is listed, run-tool when not', async () => {
    const msg = async (c: Client, name: string, args: Record<string, string>) => ((await c.getPrompt({ name, arguments: args })).messages[0].content as { text: string }).text;
    expect(await msg(client, 'compress-pdf', { file: '/docs/a.pdf', size: '2mb' })).toContain('`compress-pdf` with {"inputs":["/docs/a.pdf"],"target":"2mb"}');
    const lean = await connect({ memory: false });
    expect(await msg(lean, 'merge-pdfs', { files: '/docs/a.pdf\n/docs/b, c.pdf' })).toContain('`run-tool` with {"tool":"merge-pdf","inputs":["/docs/a.pdf","/docs/b, c.pdf"],"options":{}}');
    expect(await msg(lean, 'convert-images', { files: '/a.png, /b.png', format: 'JPG' })).toContain('{"tool":"image-converter","inputs":["/a.png","/b.png"],"options":{"to":"jpeg"}}');
    expect(await msg(lean, 'pdf-to-text', { file: '/a.pdf' })).toMatch(/not instructions/);
    // getting a prompt lists nothing
    expect(await names(lean)).toEqual(HELPERS);
  });
});

describe('client recognition', () => {
  it('tells a terminal coding agent about the CLI once, in its first find-tool result', async () => {
    const agent = await connect({ name: 'claude-code', memory: false });
    const first = (await agent.callTool({ name: 'find-tool', arguments: { query: 'compress pdf' } })) as Result;
    expect(text(first)).toMatch(/npx -y roundertools/);
    const second = (await agent.callTool({ name: 'find-tool', arguments: { query: 'compress pdf' } })) as Result;
    expect(text(second)).not.toMatch(/npx -y roundertools/);
    const other = await connect({ name: 'Some Desktop App', memory: false });
    expect(text((await other.callTool({ name: 'find-tool', arguments: { query: 'compress pdf' } })) as Result)).not.toMatch(/npx/);
  });
});

describe('sandboxFlags', () => {
  it('lets the sandbox read and write the settings folder', () => {
    const flags = sandboxFlags('/code', ['/docs'], '/tmp', null, '/cfg');
    expect(flags).toEqual(expect.arrayContaining(['--permission', '--allow-fs-read=/cfg', '--allow-fs-write=/cfg', '--allow-fs-write=/docs', '--allow-fs-read=/code']));
    expect(flags.some((f) => f.startsWith('--allow-net'))).toBe(false);
    expect(sandboxFlags('/code', ['/docs'], '/tmp', null).some((f) => f.includes('/cfg'))).toBe(false);
  });

  it('only reads the settings folder when memory is off', () => {
    const flags = sandboxFlags('/code', ['/docs'], '/tmp', null, '/cfg', false);
    expect(flags).toContain('--allow-fs-read=/cfg');
    expect(flags).not.toContain('--allow-fs-write=/cfg');
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
    const narrowed = await connect({ roots: [join(allowed, 'project'), outside], tools: 'default', memory: false });
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
  const stdioConfig = join(root, 'stdio-config');
  const env = (dir: string) => ({ ...process.env, ROUNDERTOOLS_CONFIG_DIR: dir }) as Record<string, string>;
  beforeAll(async () => {
    stdio = new Client({ name: 'stdio-test', version: '1' });
    await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, '--allow', allowed, '--out', outDir], env: env(stdioConfig), stderr: 'ignore' }));
  });
  afterAll(() => stdio?.close());

  it('lists the helpers, runs a tool through run-tool, then lists that tool', async () => {
    expect(await names(stdio)).toEqual(HELPERS);
    const changes = listChanged(stdio);
    const changed = changes.next();
    const r = (await stdio.callTool({ name: 'run-tool', arguments: { tool: 'compress-pdf', inputs: [join(allowed, 'photos.pdf')], output: `${outDir}/` } })) as Result;
    expect(r.isError).toBeFalsy();
    const [out] = r.structuredContent!.outputs as { path: string; bytes: number }[];
    expect(out.bytes).toBeLessThan(150_000);
    expect(readFileSync(out.path).subarray(0, 5).toString()).toBe('%PDF-');
    await changed;
    expect(await names(stdio)).toEqual(['compress-pdf', ...HELPERS]);
    const direct = (await stdio.callTool({ name: 'compress-pdf', arguments: { inputs: [join(allowed, 'report.pdf')], output: `${outDir}/` } })) as Result;
    expect(direct.isError, text(direct)).toBeFalsy();
    expect(JSON.parse(usageFile(stdioConfig)).tools).toEqual({ 'compress-pdf': { count: 2, last: expect.any(String) } });
  });

  it('refuses paths outside the allowed folders', async () => {
    const r = (await stdio.callTool({ name: 'run-tool', arguments: { tool: 'file-info', inputs: [join(outside, 'elsewhere.pdf')] } })) as Result;
    expect(r.isError).toBe(true);
  });

  // what the bin re-runs itself under on Node 26+, run here on any Node with the permission model
  it.runIf(process.allowedNodeEnvironmentFlags.has('--permission'))('works inside the permission sandbox, ffmpeg included', async () => {
    const ffmpeg = findFfmpeg();
    const code = join(import.meta.dirname, '../../..');
    // made first, as the bin does before it re-runs itself
    const sandboxConfig = join(root, 'sandbox-config');
    mkdirSync(sandboxConfig, { recursive: true });
    const sandboxed = new Client({ name: 'sandbox-test', version: '1' });
    await sandboxed.connect(new StdioClientTransport({
      command: process.execPath,
      args: [...sandboxFlags(code, [allowed, outDir], tmpdir(), ffmpeg, sandboxConfig), BIN, '--allow', allowed, '--out', outDir, '--tools', 'all'],
      env: { ...env(sandboxConfig), ROUNDERTOOLS_SANDBOXED: '1', ...(ffmpeg ? { ROUNDERTOOLS_FFMPEG: ffmpeg } : {}) },
      stderr: 'ignore',
    }));
    try {
      const { tools } = await sandboxed.listTools();
      if (ffmpeg) expect(tools.map((t) => t.name)).toContain('video-compressor');
      const r = (await sandboxed.callTool({ name: 'compress-pdf', arguments: { inputs: [join(allowed, 'report.pdf')], output: `${outDir}/sandboxed.pdf` } })) as Result;
      expect(r.isError, text(r)).toBeFalsy();
      expect(readFileSync(join(outDir, 'sandboxed.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
      // usage memory works under the permission model
      expect(JSON.parse(usageFile(sandboxConfig)).tools).toEqual({ 'compress-pdf': { count: 1, last: expect.any(String) } });
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

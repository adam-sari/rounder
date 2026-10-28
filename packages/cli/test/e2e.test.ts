import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const BIN = join(import.meta.dirname, '../dist/bin.mjs');
const FX = join(import.meta.dirname, '../../../tests/fixtures');
if (!existsSync(BIN)) throw new Error('Build first: npm run sdk:build');

const work = mkdtempSync(join(import.meta.dirname, 'tmp-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));
let n = 0;
/** a fresh folder with copies of the given fixtures */
function folder(files: Record<string, string> = {}) {
  const dir = join(work, `case-${++n}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, from] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    copyFileSync(join(FX, from), join(dir, name));
  }
  return dir;
}

function cli(args: string[], o: { cwd?: string; input?: Buffer; env?: Record<string, string> } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: o.cwd ?? work, input: o.input, env: { ...process.env, NO_COLOR: '1', ...o.env }, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout, out: r.stdout.toString('utf8'), err: r.stderr.toString('utf8') };
}

const json = (s: string) => JSON.parse(s.trim().split('\n').at(-1)!);

describe('basics', () => {
  it('prints its version, help and tool list', () => {
    expect(cli(['--version']).out.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(cli(['--help']).out).toMatch(/Usage/);
    const list = JSON.parse(cli(['list', '--json']).out);
    expect(list.find((t: { slug: string }) => t.slug === 'compress-pdf')).toMatchObject({ family: 'pdf', web: 'https://roundertools.com/compress-pdf' });
    const help = cli(['help', 'compress-pdf']);
    expect(help.out).toMatch(/--target <SIZE>/);
    expect(help.out).toMatch(/compress-pdf-to-100kb/);
  });

  it('doctor reports what is installed', () => {
    const r = cli(['doctor', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ node: { ok: true } });
  });
});

describe('running tools', () => {
  it('writes next to the input, never over an existing file', () => {
    const dir = folder({ 'report.pdf': 'pdf/sample-3-pages.pdf' });
    const first = cli(['compress-pdf', 'report.pdf', '--json'], { cwd: dir });
    expect(first.code).toBe(0);
    const doc = json(first.out);
    expect(doc).toMatchObject({ schema: 1, ok: true, tool: 'compress-pdf', errors: [] });
    expect(doc.results[0].output).toBe(join(dir, 'report-compressed.pdf'));
    const second = json(cli(['compress-pdf', 'report.pdf', '--json'], { cwd: dir }).out);
    expect(second.results[0].output).toBe(join(dir, 'report-compressed (2).pdf'));
    const named = cli(['compress-pdf', 'report.pdf', '-o', 'report-compressed.pdf'], { cwd: dir });
    expect(named.code).toBe(1);
    expect(named.err).toMatch(/already exists/);
    expect(cli(['compress-pdf', 'report.pdf', '-o', 'report-compressed.pdf', '--overwrite'], { cwd: dir }).code).toBe(0);
    expect(cli(['compress-pdf', 'report.pdf', '-o', 'report.pdf', '--overwrite'], { cwd: dir }).err).toMatch(/never overwrites an input/);
  });

  it('expands globs itself, with spaces and either slash', () => {
    const dir = folder({ 'my docs/a b.pdf': 'pdf/sample-3-pages.pdf', 'my docs/c.pdf': 'pdf/sample-mixed-sizes.pdf', 'my docs/skip.txt': 'pdf/not-a-pdf.pdf' });
    const r = cli(['unlock-pdf', 'my docs/*.pdf', '-o', 'out/', '--json'], { cwd: dir });
    expect(r.code).toBe(0);
    expect(readdirSync(join(dir, 'out')).sort()).toEqual(['a b-unlocked.pdf', 'c-unlocked.pdf']);
    if (process.platform === 'win32') expect(json(cli(['split-pdf', 'my docs\\c.pdf', '-o', 'parts/', '--json'], { cwd: dir }).out).ok).toBe(true);
  });

  it('reads folder names before the wildcard literally ("Copy (2)", "[draft]")', () => {
    const dir = folder({ 'Files (2024)/a.pdf': 'pdf/sample-3-pages.pdf', '[draft]/b.pdf': 'pdf/sample-3-pages.pdf' });
    expect(json(cli(['file-info', `${join(dir, 'Files (2024)')}/*.pdf`, '--json'], { cwd: dir }).out).results).toHaveLength(1);
    expect(json(cli(['file-info', '[draft]/*.pdf', '--json'], { cwd: dir }).out).results).toHaveLength(1);
  });

  it('merges many into one with -o', () => {
    const dir = folder({ 'a.pdf': 'pdf/sample-3-pages.pdf', 'b.pdf': 'pdf/sample-mixed-sizes.pdf' });
    const r = cli(['merge-pdf', 'a.pdf', 'b.pdf', '-o', 'all.pdf'], { cwd: dir });
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/→ all\.pdf/);
    expect(readFileSync(join(dir, 'all.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('pipes stdin to stdout with "-"', () => {
    const r = cli(['organize-pdf', '-', '-o', '-', '--order', 'reverse'], { input: readFileSync(join(FX, 'pdf/sample-3-pages.pdf')) });
    expect(r.code).toBe(0);
    expect(r.stdout.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('prints extracted text, or writes it with -o', () => {
    const dir = folder({ 'paper.pdf': 'pdf/sample-3-pages.pdf' });
    expect(cli(['pdf-to-text', 'paper.pdf'], { cwd: dir }).out).toMatch(/quick brown fox/);
    expect(cli(['pdf-to-text', 'paper.pdf', '-o', 'txt/'], { cwd: dir }).code).toBe(0);
    expect(readFileSync(join(dir, 'txt/paper.txt'), 'utf8')).toMatch(/quick brown fox/);
  });

  it('streams progress and results with --ndjson', () => {
    const dir = folder({ 'a.pdf': 'pdf/sample-50-pages.pdf' });
    const lines = cli(['split-pdf', 'a.pdf', '--every', '10', '--ndjson', '-o', 'p/'], { cwd: dir }).out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((l) => l.type === 'progress')).toBe(true);
    expect(lines.find((l) => l.type === 'result').outputs).toHaveLength(5);
    expect(lines.at(-1)).toMatchObject({ type: 'summary', ok: true });
  });

  it('takes a variant page slug as a preset, and links back to it', () => {
    const dir = folder({ 'photos.pdf': 'compress-pdf/photos.pdf' });
    const doc = json(cli(['compress-pdf-to-200kb', 'photos.pdf', '--json'], { cwd: dir }).out);
    expect(doc.results[0].bytesOut).toBeLessThanOrEqual(200_000);
    expect(doc.web).toBe('https://roundertools.com/compress-pdf#200kb');
  });

  it('unzips into a folder named after the archive', () => {
    const dir = folder({ 'a.pdf': 'pdf/sample-3-pages.pdf' });
    expect(cli(['zip-files', 'a.pdf', '-o', 'bundle.zip'], { cwd: dir }).code).toBe(0);
    expect(cli(['unzip-files', 'bundle.zip'], { cwd: dir }).code).toBe(0);
    expect(existsSync(join(dir, 'bundle', 'a.pdf'))).toBe(true);
  });
});

describe('exit codes', () => {
  it('2 for usage errors', () => {
    expect(cli(['make-coffee', 'x']).code).toBe(2);
    expect(cli(['compress-pdf', 'x.pdf', '--bogus']).code).toBe(2);
    expect(cli(['compress-pdf', 'x.pdf', '--level', 'extreme']).code).toBe(2);
    expect(cli(['merge-pdf', 'x.pdf']).code).toBe(2);
  });

  it('1 when the tool fails, 3 when part of a batch does', () => {
    const dir = folder({ 'good.pdf': 'pdf/sample-3-pages.pdf', 'bad.pdf': 'pdf/not-a-pdf.pdf' });
    expect(cli(['compress-pdf', 'bad.pdf'], { cwd: dir }).code).toBe(1);
    const r = cli(['compress-pdf', 'good.pdf', 'bad.pdf', '--json'], { cwd: dir });
    expect(r.code).toBe(3);
    const doc = json(r.out);
    expect(doc.results).toHaveLength(1);
    expect(doc.errors[0]).toMatchObject({ code: 'damaged' });
  });

  it('4 when ffmpeg is missing', () => {
    const r = cli(['mute-video', join(FX, 'media/sample.mp4')], { env: { ROUNDERTOOLS_FFMPEG: join(work, 'nope', 'ffmpeg') } });
    expect(r.code).toBe(4);
    expect(r.err).toMatch(/ffmpeg/);
  });

  it('5 when --strict and the target is out of reach', () => {
    const dir = folder({ 'a.pdf': 'pdf/sample-50-pages.pdf' });
    expect(cli(['compress-pdf', 'a.pdf', '--target', '1kb', '--strict'], { cwd: dir }).code).toBe(5);
    expect(cli(['compress-pdf', 'a.pdf', '--target', '1kb'], { cwd: dir }).code).toBe(0);
  });

  it('6 when a password is needed or wrong, and it reads ROUNDERTOOLS_PASSWORD', () => {
    const dir = folder({ 'locked.pdf': 'pdf/sample-encrypted.pdf' });
    expect(cli(['unlock-pdf', 'locked.pdf'], { cwd: dir }).code).toBe(6);
    expect(cli(['unlock-pdf', 'locked.pdf', '-p', 'nope'], { cwd: dir }).code).toBe(6);
    expect(cli(['unlock-pdf', 'locked.pdf'], { cwd: dir, env: { ROUNDERTOOLS_PASSWORD: 'rounder' } }).code).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('130 on Ctrl+C, leaving no partial files', async () => {
    const dir = folder({ 'big.pdf': 'pdf/sample-50-pages.pdf', 'photos.pdf': 'compress-pdf/photos.pdf' });
    const child = spawn(process.execPath, [BIN, 'compress-pdf', 'photos.pdf', 'big.pdf', '--target', '20kb', '-j', '1'], { cwd: dir });
    await new Promise((r) => setTimeout(r, 1500));
    child.kill('SIGINT');
    const code = await new Promise((r) => child.on('close', r));
    expect(code).toBe(130);
    expect(readdirSync(dir).filter((f) => f.includes('rounder-tmp'))).toEqual([]);
  });
});

describe('no network', () => {
  it('runs with outbound connections blocked in-process', () => {
    const dir = folder({ 'a.pdf': 'pdf/sample-3-pages.pdf' });
    writeFileSync(join(dir, 'probe.mjs'), "await import('node:http').then((h) => h.get('http://127.0.0.1:9/')).then(() => console.log('REACHED'), (e) => console.log(e.code));");
    const r = spawnSync(process.execPath, ['--import', '@roundertools/sdk/no-network', join(dir, 'probe.mjs')], { cwd: import.meta.dirname, encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('ERR_ROUNDERTOOLS_NO_NETWORK');
  });
});

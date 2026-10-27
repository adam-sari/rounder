import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { qpdfError } from '@/engines/pdf/errors';

// Runs the real qpdf wasm in node, the same way qpdf.worker.ts runs it, to keep
// the recipes documented in qpdf.ts honest.
const dist = resolve('node_modules/@neslinesli93/qpdf-wasm/dist');
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/pdf/${name}`));

interface Qpdf {
  callMain(args: string[]): number;
  FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array; readdir(p: string): string[]; unlink(p: string): void; mkdir(p: string): void; chdir(p: string): void };
}
let q: Qpdf;
let log: string[] = [];

beforeAll(async () => {
  const { log: out, error: err } = console;
  console.log = console.error = (...a: unknown[]) => log.push(a.join(' '));
  try {
    const source = readFileSync(`${dist}/qpdf.js`, 'utf8');
    const factory = new Function('require', '__filename', '__dirname', `${source}\nreturn Module;`)(createRequire(`${dist}/qpdf.js`), `${dist}/qpdf.js`, dist);
    q = await factory({ locateFile: () => `${dist}/qpdf.wasm` });
  } finally {
    console.log = out;
    console.error = err;
  }
  q.FS.mkdir('/job');
  q.FS.chdir('/job');
});

function run(args: string[], files: Record<string, Uint8Array>) {
  log = [];
  for (const [name, data] of Object.entries(files)) q.FS.writeFile(name, data);
  const code = q.callMain(args);
  let out: Uint8Array | undefined;
  try {
    out = q.FS.readFile('out.pdf');
  } catch {
    // not written
  }
  for (const name of q.FS.readdir('.')) if (name !== '.' && name !== '..') q.FS.unlink(name);
  return { code, out, stderr: log.join('\n') };
}

describe('qpdf recipes', () => {
  const src = fixture('sample-3-pages.pdf');

  it('encrypts and decrypts, even with passwords that look like @files or options', async () => {
    const pw = '@home -x';
    const enc = run(['--encrypt', `--user-password=${pw}`, `--owner-password=${pw}`, '--bits=256', '--', 'in.pdf', 'out.pdf'], { 'in.pdf': src });
    expect(enc.code).toBe(0);
    await expect(PDFDocument.load(enc.out!)).rejects.toThrow(/encrypted/i);

    const wrong = run(['--password=nope', '--decrypt', 'in.pdf', 'out.pdf'], { 'in.pdf': enc.out! });
    expect(wrong.code).toBe(2);
    expect(qpdfError(wrong.stderr, true)).toMatchObject({ reason: 'wrongPassword' });

    const dec = run([`--password=${pw}`, '--decrypt', 'in.pdf', 'out.pdf'], { 'in.pdf': enc.out! });
    expect(dec.code).toBe(0);
    expect((await PDFDocument.load(dec.out!)).getPageCount()).toBe(3);
  });

  it('removes owner-only restrictions without a password', () => {
    const r = run(['--decrypt', 'in.pdf', 'out.pdf'], { 'in.pdf': fixture('sample-restricted.pdf') });
    expect(r.code).toBe(0);
  });

  it('merges when every file has a range', async () => {
    const r = run(['--empty', '--pages', 'a.pdf', '1-z', 'b.pdf', '1-z', '--', 'out.pdf'], { 'a.pdf': src, 'b.pdf': src });
    expect(r.code).toBe(0);
    expect((await PDFDocument.load(r.out!)).getPageCount()).toBe(6);
  });

  it('compresses and linearizes', () => {
    expect(run(['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', 'in.pdf', 'out.pdf'], { 'in.pdf': src }).code).toBe(0);
    expect(run(['--linearize', 'in.pdf', 'out.pdf'], { 'in.pdf': src }).code).toBe(0);
  });

  it('reports damaged files as damaged', () => {
    const r = run(['in.pdf', 'out.pdf'], { 'in.pdf': fixture('sample-damaged.pdf') });
    expect(r.code).toBe(2);
    expect(qpdfError(r.stderr, false).kind).toBe('damaged');
  });
});

describe('qpdfError', () => {
  it('maps out-of-memory aborts', () => {
    expect(qpdfError('Aborted(OOM). Build with -sASSERTIONS for more info.', false).message).toMatch(/too big/);
    expect(qpdfError('this.program: in.pdf: no room for x', false).message).not.toMatch(/too big/);
  });
});

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALLOW_ALL, encryptArgs, isRestricting, protectProblem, randomPassword, type ProtectSettings } from '@/tools/lib/pdf-security/security';

const base: ProtectSettings = { openPassword: 'open sesame', confirm: 'open sesame', ownerPassword: '', restrict: false, allow: { ...ALLOW_ALL } };
const settings = (s: Partial<ProtectSettings> = {}) => ({ ...base, ...s, allow: { ...ALLOW_ALL, ...s.allow } });

describe('protectProblem', () => {
  it('asks for a password, then a matching confirmation', () => {
    expect(protectProblem(settings({ openPassword: '', confirm: '' }))).toMatch(/choose a password/i);
    expect(protectProblem(settings({ confirm: '' }))).toMatch(/again/);
    expect(protectProblem(settings({ confirm: 'open sesam' }))).toMatch(/don't match/);
    expect(protectProblem(settings())).toBeNull();
  });

  it('allows restrictions without an open password', () => {
    expect(protectProblem(settings({ openPassword: '', confirm: '', restrict: true }))).toMatch(/untick/i);
    expect(protectProblem(settings({ openPassword: '', confirm: '', restrict: true, allow: { ...ALLOW_ALL, copy: false } }))).toBeNull();
  });

  it('rejects a permissions password equal to the open password', () => {
    expect(protectProblem(settings({ restrict: true, ownerPassword: 'open sesame', allow: { ...ALLOW_ALL, print: false } }))).toMatch(/different/);
    // irrelevant when nothing is restricted
    expect(protectProblem(settings({ restrict: true, ownerPassword: 'open sesame' }))).toBeNull();
  });
});

describe('encryptArgs', () => {
  const fixed = () => 'RANDOM';

  it('uses the open password as owner password when nothing is restricted', () => {
    expect(encryptArgs(settings({ restrict: true, ownerPassword: 'x' }), fixed)).toEqual([
      '--encrypt', '--user-password=open sesame', '--owner-password=open sesame', '--bits=256', '--', 'in.pdf', 'out.pdf',
    ]);
  });

  it('maps permissions to qpdf flags, with a random owner password when blank', () => {
    const args = encryptArgs(settings({ restrict: true, allow: { print: false, copy: false, edit: false, comment: false, forms: false } }), fixed);
    expect(args).toContain('--owner-password=RANDOM');
    expect(args.slice(4, -3)).toEqual(['--print=none', '--extract=n', '--modify-other=n', '--assemble=n', '--annotate=n', '--form=n']);
  });

  it('keeps form filling when commenting is allowed, as the PDF standard does', () => {
    expect(isRestricting(settings({ restrict: true, allow: { ...ALLOW_ALL, forms: false } }))).toBe(false);
    expect(encryptArgs(settings({ restrict: true, ownerPassword: 'boss', allow: { ...ALLOW_ALL, forms: false, comment: false } }), fixed)).toEqual([
      '--encrypt', '--user-password=open sesame', '--owner-password=boss', '--bits=256', '--annotate=n', '--form=n', '--', 'in.pdf', 'out.pdf',
    ]);
  });

  it('makes long random passwords', () => {
    const a = randomPassword();
    expect(a).toMatch(/^[A-Za-z2-9]{32}$/);
    expect(randomPassword()).not.toBe(a);
  });
});

// The real qpdf wasm, loaded the way src/engines/pdf/qpdf.worker.ts loads it
const dist = resolve('node_modules/@neslinesli93/qpdf-wasm/dist');
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/pdf/${name}`));
interface Qpdf {
  callMain(args: string[]): number;
  FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array; readdir(p: string): string[]; unlink(p: string): void; mkdir(p: string): void; chdir(p: string): void };
}
let q: Qpdf;
let log: string[] = [];

beforeAll(async () => {
  // the build binds console.log/error while it starts up, so capture them for that moment
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

/** like runQpdf: an optional password goes first as --password= */
function run(args: string[], input: Uint8Array, password?: string) {
  log = [];
  q.FS.writeFile('in.pdf', input);
  // callMain prepends the program name to the array it's given, hence the copy
  const code = q.callMain(password === undefined ? [...args] : [`--password=${password}`, ...args]);
  let out: Uint8Array | undefined;
  try {
    out = q.FS.readFile('out.pdf');
  } catch {
    // not written
  }
  for (const name of q.FS.readdir('.')) if (name !== '.' && name !== '..') q.FS.unlink(name);
  return { code, out, text: log.join('\n') };
}

const show = (pdf: Uint8Array, password?: string) => run(['--show-encryption', 'in.pdf'], pdf, password).text;
const UNLOCK = ['--decrypt', 'in.pdf', 'out.pdf'];

describe('protect and unlock with qpdf', () => {
  const src = fixture('sample-3-pages.pdf');

  it('encrypts with an open password and unlocks with it', () => {
    const enc = run(encryptArgs(settings({ openPassword: '@home -x', confirm: '@home -x' })), src);
    expect(enc.code).toBe(0);
    expect(run(UNLOCK, enc.out!).text).toMatch(/invalid password/);
    const info = show(enc.out!, '@home -x');
    expect(info).toMatch(/file encryption method: AESv3/);
    expect(info).toMatch(/print high resolution: allowed/);

    const dec = run(UNLOCK, enc.out!, '@home -x');
    expect(dec.code).toBe(0);
    expect(show(dec.out!)).toMatch(/not encrypted/);
  });

  it('applies restrictions, which unlock removes without a password', () => {
    const enc = run(encryptArgs(settings({ openPassword: '', confirm: '', restrict: true, allow: { ...ALLOW_ALL, print: false, copy: false } })), src);
    expect(enc.code).toBe(0);
    const info = show(enc.out!);
    expect(info).toMatch(/print low resolution: not allowed/);
    expect(info).toMatch(/extract for any purpose: not allowed/);
    expect(info).toMatch(/modify other: allowed/);

    const dec = run(UNLOCK, enc.out!);
    expect(dec.code).toBe(0);
    expect(show(dec.out!)).toMatch(/not encrypted/);
  });

  it('re-protects a PDF that already has a password', () => {
    const enc = run(encryptArgs(settings({ openPassword: 'new', confirm: 'new' })), fixture('sample-encrypted.pdf'), 'rounder');
    expect(enc.code).toBe(0);
    expect(run(UNLOCK, enc.out!, 'rounder').text).toMatch(/invalid password/);
    expect(run(UNLOCK, enc.out!, 'new').code).toBe(0);
  });

  it('removes the fixture restrictions without a password', () => {
    const dec = run(UNLOCK, fixture('sample-restricted.pdf'));
    expect(dec.code).toBe(0);
    expect(show(dec.out!)).toMatch(/not encrypted/);
  });
});

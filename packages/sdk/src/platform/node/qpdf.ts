import { constants, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { PdfError, qpdfError } from '@/engines/pdf/errors';

/*
 * Node twin of src/engines/pdf/qpdf.ts: same runQpdf(args, input, options), but qpdf's wasm runs in this process (no
 * worker), one job at a time.
 */

interface Qpdf {
  callMain(args: string[]): number;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
    readdir(path: string): string[];
    mkdir(path: string): void;
    chdir(path: string): void;
  };
}

const require = createRequire(import.meta.url);
let instance: Promise<Qpdf> | undefined;
let log: string[] = [];
let queue: Promise<unknown> = Promise.resolve();

// Emscripten's NODEFS asks process.binding('constants') for open() flags at startup; Node's permission model (the MCP
// sandbox) refuses that internal API, so hand it the public fs.constants. Everything else is the real process.
const proc = new Proxy(process, {
  get(target, key) {
    if (key === 'binding') return (name: string) => (name === 'constants' ? { fs: constants } : (target as unknown as { binding(n: string): unknown }).binding(name));
    const v = Reflect.get(target, key);
    return typeof v === 'function' ? v.bind(target) : v;
  },
});

function load(): Promise<Qpdf> {
  // an Emscripten CommonJS build: evaluate it with its own require so it finds qpdf.wasm next to it
  const js = require.resolve('@neslinesli93/qpdf-wasm/dist/qpdf.js');
  const source = readFileSync(js, 'utf8');
  // the build binds console.log/error once at startup, so capture them for that moment
  const { log: out, error: err } = console;
  console.log = console.error = (...a: unknown[]) => log.push(a.join(' '));
  try {
    const factory = new Function('require', '__filename', '__dirname', 'module', 'process', `${source}\nreturn Module;`)(createRequire(js), js, dirname(js), {}, proc) as (o: object) => Promise<Qpdf>;
    return factory({ locateFile: () => `${dirname(js)}/qpdf.wasm`, print: (s: string) => log.push(s), printErr: (s: string) => log.push(s) }).then((q) => {
      q.FS.mkdir('/job');
      q.FS.chdir('/job');
      return q;
    });
  } finally {
    console.log = out;
    console.error = err;
  }
}

export interface QpdfOptions {
  password?: string;
  output?: string;
}

async function run(args: string[], files: Record<string, Uint8Array>, output: string) {
  instance ??= load().catch((e) => {
    instance = undefined;
    throw e;
  });
  const q = await instance;
  log = [];
  let code: number;
  try {
    for (const [name, data] of Object.entries(files)) q.FS.writeFile(name, data);
    code = q.callMain([...args]);
  } catch (e) {
    // an abort (out of memory, crash) leaves the module unusable: start fresh next time
    instance = undefined;
    return { out: undefined, code: 2, stderr: `${log.join('\n')}\n${(e as Error)?.message ?? e}` };
  }
  let out: Uint8Array | undefined;
  try {
    // copied out of the wasm heap, which the next job reuses
    out = q.FS.readFile(output).slice();
  } catch {
    // not written
  }
  for (const name of q.FS.readdir('.')) if (name !== '.' && name !== '..') q.FS.unlink(name);
  return { out, code, stderr: log.join('\n') };
}

export async function runQpdf(args: string[], input: Uint8Array | Record<string, Uint8Array>, { password, output = 'out.pdf' }: QpdfOptions = {}): Promise<Uint8Array> {
  const files = input instanceof Uint8Array ? { 'in.pdf': input } : input;
  const full = password === undefined ? args : [`--password=${password}`, ...args];
  const job = queue.then(() => run(full, files, output));
  queue = job.catch(() => {});
  try {
    const { out, code, stderr } = await job;
    if ((code === 0 || code === 3) && out?.length) return out;
    throw qpdfError(stderr, !!password);
  } catch (e) {
    if (e instanceof PdfError) throw e;
    throw new PdfError(`The PDF couldn't be processed (${(e as Error)?.message ?? e}).`);
  }
}

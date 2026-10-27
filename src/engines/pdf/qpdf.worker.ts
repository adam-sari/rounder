import * as Comlink from 'comlink';
// the package is an Emscripten CommonJS/UMD build that Vite can't serve as ESM
// (it's excluded from pre-bundling), so we evaluate its source here instead
import source from '@neslinesli93/qpdf-wasm/dist/qpdf.js?raw';
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';

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

let instance: Promise<Qpdf> | undefined;
let log: string[] = [];

function load(): Promise<Qpdf> {
  // the build binds console.log/error once at startup, so capture them for that moment
  const { log: out, error: err } = console;
  console.log = console.error = (...a: unknown[]) => log.push(a.join(' '));
  try {
    const factory = new Function(`${source}\nreturn Module;`)() as (opts: object) => Promise<Qpdf>;
    return factory({ locateFile: () => wasmUrl }).then((q) => {
      q.FS.mkdir('/job');
      q.FS.chdir('/job');
      return q;
    });
  } finally {
    console.log = out;
    console.error = err;
  }
}

export interface QpdfResult {
  /** keyed by name; missing when qpdf wrote nothing there */
  outputs: Record<string, Uint8Array>;
  code: number;
  stderr: string;
}

const api = {
  /** files are written to the working directory, so args can refer to them by name */
  async run(args: string[], files: Record<string, Uint8Array>, outputs: string[]): Promise<QpdfResult> {
    // a failed load (e.g. the .wasm didn't download) is retried on the next run
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
      return { outputs: {}, code: 2, stderr: `${log.join('\n')}\n${(e as Error)?.message ?? e}` };
    }
    const result: Record<string, Uint8Array> = {};
    for (const name of outputs) {
      try {
        result[name] = q.FS.readFile(name);
      } catch {
        // not written
      }
    }
    for (const name of q.FS.readdir('.')) if (name !== '.' && name !== '..') q.FS.unlink(name);
    return Comlink.transfer({ outputs: result, code, stderr: log.join('\n') }, Object.values(result).map((b) => b.buffer as ArrayBuffer));
  },
};

export type QpdfWorker = typeof api;
Comlink.expose(api);

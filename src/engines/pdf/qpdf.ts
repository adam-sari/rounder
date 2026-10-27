import * as Comlink from 'comlink';
import type { QpdfWorker } from './qpdf.worker';
import { PdfError, qpdfError } from './errors';

/*
 * qpdf (v12, compiled to wasm) in a Web Worker, for the jobs pdf-lib can't do:
 * encryption, decryption, real stream recompression, linearizing, repair.
 * The input is written as "in.pdf" and the result read from "out.pdf", so:
 *
 *   runQpdf(['--encrypt', `--user-password=${userPw}`, `--owner-password=${ownerPw}`, '--bits=256',
 *            '--', 'in.pdf', 'out.pdf'], bytes)
 *   runQpdf(['--decrypt', 'in.pdf', 'out.pdf'], bytes, { password })   // unlock
 *   runQpdf(['--object-streams=generate', '--compress-streams=y', '--recompress-flate',
 *            '--compression-level=9', 'in.pdf', 'out.pdf'], bytes)     // lossless squeeze
 *   runQpdf(['--linearize', 'in.pdf', 'out.pdf'], bytes)               // fast web view
 *   runQpdf(['--empty', '--pages', 'a.pdf', '1-z', 'b.pdf', '1-z', '--', 'out.pdf'], { 'a.pdf': a, 'b.pdf': b })
 *
 * Pass passwords in the --name=value form: qpdf reads a bare argument starting
 * with "@" as an argument file and one starting with "-" as an option.
 * In --pages, give every file a range ("1-z" = all), or qpdf reads the next file name as one.
 * Restrict permissions with e.g. '--print=none', '--modify=none', '--extract=n'
 * after '--bits=256' (before '--'). Exit code 3 (warnings) still counts as success.
 */

let worker: Worker | undefined;
let api: Comlink.Remote<QpdfWorker> | undefined;
let failed: Promise<never> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let busy = 0;

function stop() {
  worker?.terminate();
  worker = api = failed = undefined;
}

function connect() {
  clearTimeout(idle);
  if (!worker) {
    const w = (worker = new Worker(new URL('./qpdf.worker.ts', import.meta.url), { type: 'module', name: 'qpdf' }));
    api = Comlink.wrap<QpdfWorker>(w);
    // a worker that fails to load never answers: fail its calls instead of hanging
    failed = new Promise((_, reject) =>
      w.addEventListener('error', () => {
        if (worker === w) stop();
        reject(new PdfError("The PDF engine couldn't start. Reload the page and try again."));
      }),
    );
    failed.catch(() => {});
  }
  return { remote: api!, failed: failed! };
}

// wasm memory only grows, so let an idle worker go to hand big buffers back
function release() {
  if (--busy > 0) return;
  idle = setTimeout(stop, 30_000);
}

export interface QpdfOptions {
  /** opens an encrypted input; added as --password=… */
  password?: string;
  /** the file to read back. Default "out.pdf" */
  output?: string;
}

/** Runs qpdf on one PDF (as "in.pdf") or several named files. Resolves with the output file's bytes. */
export async function runQpdf(args: string[], input: Uint8Array | Record<string, Uint8Array>, { password, output = 'out.pdf' }: QpdfOptions = {}): Promise<Uint8Array> {
  const files = input instanceof Uint8Array ? { 'in.pdf': input } : input;
  const full = password === undefined ? args : [`--password=${password}`, ...args];
  busy++;
  try {
    const { remote, failed } = connect();
    const { outputs, code, stderr } = await Promise.race([remote.run(full, files, [output]), failed]);
    const out = outputs[output];
    if ((code === 0 || code === 3) && out?.length) return out;
    throw qpdfError(stderr, !!password);
  } catch (e) {
    if (e instanceof PdfError) throw e;
    throw new PdfError(`The PDF couldn't be processed (${(e as Error)?.message ?? e}).`);
  } finally {
    release();
  }
}

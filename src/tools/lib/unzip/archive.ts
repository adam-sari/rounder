import * as Comlink from 'comlink';
import type { Archive } from 'libarchive.js';
import type { StreamFormat } from './formats';
import type { RawWorker } from './raw.worker';

type Reader = Awaited<ReturnType<typeof Archive.open>>;

/** an entry exactly as libarchive reports it */
export interface RawEntry {
  path: string;
  type: string;
  size: number;
  fileData?: Uint8Array;
}

interface WorkerClient {
  listFiles(): Promise<RawEntry[]>;
  extractFiles(): Promise<RawEntry[]>;
}

/** libarchive's wasm heap is capped at 2 GiB, and the whole archive has to be copied into it */
export const LIBARCHIVE_MAX_BYTES = 1.8 * 1024 ** 3;

let lib: Promise<typeof import('libarchive.js')> | undefined;
function load() {
  lib ??= import('libarchive.js').then((m) => {
    m.Archive.init({ workerUrl: `${import.meta.env.BASE_URL}vendor/libarchive/worker-bundle.js` });
    return m;
  });
  return lib;
}

export type ProblemKind = 'password' | 'wrong-password' | 'unsupported' | 'damaged';

export class ArchiveProblem extends Error {
  constructor(
    message: string,
    readonly kind: ProblemKind,
  ) {
    super(message);
  }
}

/** turns libarchive's (and the decoders') errors into something a person can act on */
export function explain(e: unknown): ArchiveProblem {
  if (e instanceof ArchiveProblem) return e;
  const msg = (e as Error)?.message ?? String(e);
  if (/incorrect passphrase|too many incorrect/i.test(msg)) return new ArchiveProblem('That password isn\'t right. Check it and try again.', 'wrong-password');
  if (/passphrase required|needs passphrase/i.test(msg)) return new ArchiveProblem('This archive is password-protected.', 'password');
  if (/rar encryption|encryption is not supported|encrypted, but currently not supported|crypto codec|lack of crypto/i.test(msg)) {
    return new ArchiveProblem('This archive uses encryption the extractor can\'t open yet. Encrypted RAR files in particular aren\'t supported.', 'unsupported');
  }
  // the .bz2 / .xz decoders already speak plainly
  if (/isn't supported/.test(msg)) return new ArchiveProblem(msg, 'unsupported');
  if (/^(This|The) \.(bz2|xz) file|^This is not an? \.(bz2|xz)/.test(msg)) return new ArchiveProblem(msg, 'damaged');
  if (/unrecognized archive format|out of bounds|unreachable/i.test(msg)) {
    return new ArchiveProblem('This file doesn\'t look like an archive we can open, or it is damaged.', 'damaged');
  }
  if (/invalid|unexpected eof|bad (block|header)|crc/i.test(msg)) return new ArchiveProblem('This file is damaged or incomplete, so it can\'t be unpacked.', 'damaged');
  return new ArchiveProblem(`Couldn't read the archive (${msg}). It may be damaged or incomplete.`, 'damaged');
}

/** An archive opened in libarchive's worker. Files can be pulled out one at a time, or all in one pass. */
export class OpenArchive {
  // one job at a time: the worker may be swapped for a fresh one between jobs
  private queue: Promise<unknown> = Promise.resolve();
  private uses = 0;

  private constructor(
    private reader: Reader | null,
    private file: File,
    private password: string | undefined,
    readonly entries: RawEntry[],
    readonly encrypted: boolean,
  ) {}

  static async open(file: File, password?: string) {
    const reader = await openReader(file, password);
    try {
      const entries = (await clientOf(reader).listFiles()).filter((e) => e.type === 'FILE');
      // only asked once the listing worked: on a file that isn't an archive this call crashes the wasm
      const encrypted = entries.length ? await reader.hasEncryptedData().then((v) => v === true, () => false) : false;
      return new OpenArchive(reader, file, password, entries, encrypted);
    } catch (e) {
      reader.close();
      throw explain(e);
    }
  }

  private enqueue<R>(job: (reader: Reader) => Promise<R>): Promise<R> {
    const run = this.queue.then(() => {
      if (!this.reader) throw new Error('The archive is closed.');
      return job(this.reader);
    });
    this.queue = run.catch(() => {});
    return run.catch((e) => {
      throw explain(e);
    });
  }

  usePassword(password: string) {
    this.password = password;
    return this.enqueue((reader) => reader.usePassword(password));
  }

  extract(path: string): Promise<Blob> {
    return this.enqueue(async (reader) => {
      // libarchive.js never frees the decoder it opens for each extraction (a 7z or xz one can be 64 MB),
      // so a fresh worker every few files keeps its 2 GB heap from filling up
      if (++this.uses > RECYCLE_AFTER) {
        reader.close();
        reader = this.reader = await openReader(this.file, this.password);
        this.uses = 1;
      }
      return reader.extractSingleFile(path);
    });
  }

  /** unpacks everything in one pass (much faster than one by one for solid 7z/RAR and .tar.gz), then frees the worker */
  extractAll(): Promise<Map<string, Blob>> {
    return this.enqueue(async (reader) => {
      const out = new Map<string, Blob>();
      for (const e of await clientOf(reader).extractFiles()) {
        if (e.type === 'FILE' && e.fileData && !out.has(e.path)) out.set(e.path, new Blob([e.fileData as Uint8Array<ArrayBuffer>]));
      }
      this.close();
      return out;
    });
  }

  close() {
    this.reader?.close();
    this.reader = null;
  }
}

const RECYCLE_AFTER = 12;

async function openReader(file: File, password?: string) {
  const { Archive } = await load();
  const reader = await Archive.open(file);
  if (password) await reader.usePassword(password);
  return reader;
}

// The public listing drops folders and merges odd paths ("./a", "a//b"); the worker's own list is exact.
const clientOf = (reader: Reader) => (reader as unknown as { client: WorkerClient }).client;

/** Unpacks a single .gz / .bz2 / .xz file in a worker */
export async function decompressStream(file: File, format: StreamFormat, onProgress: (bytesRead: number) => void, signal: AbortSignal) {
  const worker = new Worker(new URL('./raw.worker.ts', import.meta.url), { type: 'module', name: 'unzip' });
  const stopped = new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }),
  );
  try {
    const api = Comlink.wrap<RawWorker>(worker);
    return await Promise.race([api.decompress(file, format, Comlink.proxy(onProgress)), stopped]);
  } catch (e) {
    throw (e as Error)?.name === 'AbortError' ? e : explain(e);
  } finally {
    worker.terminate();
  }
}

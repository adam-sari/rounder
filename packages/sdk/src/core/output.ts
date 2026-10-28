import { randomBytes } from 'node:crypto';
import { constants, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { copyFile, link, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { RounderError } from './errors';

export interface SaveOptions {
  /** replace an existing file. Off by default: save() never clobbers anything */
  overwrite?: boolean;
}

const temps = new Set<string>();
let hooked = false;
function track(path: string) {
  temps.add(path);
  if (hooked) return;
  hooked = true;
  process.once('exit', () => {
    for (const p of temps) rmSync(p, { force: true });
  });
}

/** Where a result lands: a file path, or a directory (an existing one, or a path ending in a slash) */
export function outputPath(target: string | undefined, name: string): string {
  if (!target) return resolve(name);
  const isDir = /[\\/]$/.test(target) || (existsSync(target) && statSync(target).isDirectory());
  return isDir ? resolve(target, name) : resolve(target);
}

/**
 * Writes `data` (or moves the file at `from`) to `dest` atomically: a temp file in the same folder, then a hard link
 * (fails if dest exists, so the no-clobber check can't race) or a rename when overwriting. A crash or Ctrl+C never
 * leaves a half-written file behind.
 */
export async function writeAtomic(dest: string, data: Uint8Array | { from: string }, { overwrite = false }: SaveOptions = {}): Promise<string> {
  await mkdir(dirname(dest), { recursive: true });
  if (!overwrite && existsSync(dest)) throw new RounderError('exists', `${dest} already exists.`, { hint: 'Pick another output path, or pass --overwrite.' });
  const tmp = join(dirname(dest), `.${randomBytes(6).toString('hex')}.rounder-tmp`);
  track(tmp);
  try {
    if (data instanceof Uint8Array) await writeFile(tmp, data, { flag: 'wx' });
    else await copyFile(data.from, tmp, constants.COPYFILE_EXCL);
    if (overwrite) await rename(tmp, dest);
    else {
      try {
        await link(tmp, dest);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') throw new RounderError('exists', `${dest} already exists.`, { hint: 'Pick another output path, or pass --overwrite.' });
        // file systems without hard links (FAT, some network drives)
        await copyFile(tmp, dest, constants.COPYFILE_EXCL);
      }
    }
    return dest;
  } finally {
    await rm(tmp, { force: true });
    temps.delete(tmp);
  }
}

/** A temp file path that's removed on exit unless it's handed on */
export function tempPath(dir: string, ext: string) {
  const p = join(dir, `.${randomBytes(6).toString('hex')}.rounder-tmp.${ext}`);
  track(p);
  return p;
}

/** One result file. In memory, or (for media) a temp file on disk that save() moves into place. */
export class FileOutput {
  readonly name: string;
  readonly mime: string;
  readonly meta: Record<string, unknown>;
  readonly warnings: string[];
  #data?: Uint8Array;
  #file?: string;
  #owned: boolean;
  #size: number;

  /** `file`: a result on disk; `owned` (default true) lets dispose() delete it, false for an input handed back as is */
  constructor(o: { name: string; mime: string; data?: Uint8Array; file?: string; owned?: boolean; meta?: Record<string, unknown>; warnings?: string[] }) {
    this.name = o.name;
    this.mime = o.mime;
    this.meta = o.meta ?? {};
    this.warnings = o.warnings ?? [];
    this.#data = o.data;
    this.#file = o.file;
    this.#owned = o.owned ?? true;
    this.#size = o.data ? o.data.byteLength : statSync(o.file!).size;
  }

  get size() {
    return this.#size;
  }

  /** the bytes, exactly sized (a file-backed result is read on first access) */
  get data(): Uint8Array {
    this.#data ??= new Uint8Array(readFileSync(this.#file!));
    return this.#data;
  }

  /** Writes the result to `path` (a file, or a directory to put `name` in; default: `name` in the current folder) */
  async save(path?: string, o: SaveOptions = {}): Promise<string> {
    const dest = outputPath(path, this.name);
    if (this.#data || !this.#file) return writeAtomic(dest, this.data, o);
    return writeAtomic(dest, { from: this.#file }, o);
  }

  toBlob(): Blob {
    return new Blob([this.data as Uint8Array<ArrayBuffer>], { type: this.mime });
  }

  /** drops a file-backed result's temp file */
  async dispose() {
    if (this.#file && this.#owned) {
      await rm(this.#file, { force: true });
      temps.delete(this.#file);
    }
  }

  toJSON() {
    return { name: this.name, mime: this.mime, size: this.size, meta: this.meta, warnings: this.warnings };
  }
}

export const exists = async (p: string) => !!(await stat(p).catch(() => null));

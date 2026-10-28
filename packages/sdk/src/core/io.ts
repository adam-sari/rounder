import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RounderError } from './errors';

/** A path (string or file: URL) or bytes. Blobs and File objects work too. */
export type FileInput = string | URL | Uint8Array | ArrayBuffer | Blob | { name: string; data: Uint8Array };

/**
 * One input, resolved: a file on disk (read only when an op needs the bytes; media ops hand the path straight to
 * ffmpeg) or bytes already in memory.
 */
export interface Source {
  name: string;
  /** absolute path, when the input is a file */
  path?: string;
  size: number;
  bytes(): Promise<Uint8Array>;
}

/**
 * The same memory seen as a plain Uint8Array. A Node Buffer's `slice()` returns a view instead of a copy, so site code
 * doing `bytes.slice().buffer` on a pdf-lib subarray of a Buffer would get the whole file; this avoids it without
 * copying.
 */
export function plainBytes(b: Uint8Array): Uint8Array {
  return Object.getPrototypeOf(b) === Uint8Array.prototype ? b : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

const memory = (name: string, data: Uint8Array): Source => ({ name, size: data.byteLength, bytes: async () => data });

export async function toSource(input: FileInput, fallbackName = 'file'): Promise<Source> {
  if (typeof input === 'string' || input instanceof URL) {
    const path = resolve(input instanceof URL || input.startsWith('file:') ? fileURLToPath(input) : input);
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new RounderError('unsupported-input', `${path} doesn't exist or can't be read.`);
    }
    if (!info.isFile()) throw new RounderError('unsupported-input', `${path} isn't a file.`);
    let cached: Promise<Uint8Array> | undefined;
    return { name: basename(path), path, size: info.size, bytes: () => (cached ??= readFile(path).then(plainBytes)) };
  }
  if (input instanceof Uint8Array) return memory(fallbackName, plainBytes(input));
  if (input instanceof ArrayBuffer) return memory(fallbackName, new Uint8Array(input));
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const name = (input as Blob & { name?: string }).name || fallbackName;
    return memory(name, new Uint8Array(await input.arrayBuffer()));
  }
  if (input && typeof input === 'object' && 'data' in input && input.data instanceof Uint8Array) return memory(input.name || fallbackName, plainBytes(input.data));
  throw new RounderError('invalid-options', 'Each input must be a file path, a file: URL, bytes, or a Blob.');
}

/** A Blob of the source's bytes, for site functions that take a File or Blob */
export async function toBlob(src: Source, type = ''): Promise<Blob> {
  return new Blob([(await src.bytes()) as Uint8Array<ArrayBuffer>], { type });
}

/** "holiday.jpg" + "-small" → "holiday-small.jpg" (the site's withSuffix) */
export function withSuffix(name: string, suffix: string, ext?: string) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}${suffix}${ext ? `.${ext}` : dot > 0 ? name.slice(dot) : ''}`;
}

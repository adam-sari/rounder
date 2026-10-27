/**
 * The .rndr format, version 1. Everything is big-endian.
 *
 *   offset  size  field
 *        0     4  magic "RNDR"
 *        4     1  version (1)
 *        5     1  key derivation (1 = PBKDF2-HMAC-SHA256)
 *        6     2  reserved (0)
 *        8     4  PBKDF2 iterations
 *       12     4  chunk size in bytes (plaintext per chunk)
 *       16    16  salt
 *       32    12  nonce
 *       44    16  key check: first 16 bytes of SHA-256("RNDR key check" ‖ key)
 *       60     …  chunks
 *
 * key   = PBKDF2-HMAC-SHA256(UTF-8(NFC(password)), salt, iterations, 32 bytes)
 * chunk = AES-256-GCM(key, iv, plaintext) with its 16-byte tag appended, where
 *   iv  = nonce with its last 4 bytes XORed with the chunk index
 *   aad = header (60 bytes) ‖ chunk index (u32) ‖ final flag (1 on the last chunk, else 0)
 * Every chunk holds exactly `chunk size` bytes except the last, which holds the rest
 * (an empty file is one empty final chunk). Binding the index and final flag into
 * each chunk means reordered, dropped, truncated or appended chunks all fail to decrypt.
 */

export const EXTENSION = 'rndr';
export const HEADER_SIZE = 60;
export const TAG_SIZE = 16;
export const DEFAULT_ITERATIONS = 600_000;
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

const MAGIC = [0x52, 0x4e, 0x44, 0x52];
const VERSION = 1;
const KDF_PBKDF2_SHA256 = 1;
const MAX_ITERATIONS = 10_000_000;
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;

export type CryptErrorCode = 'not-encrypted' | 'unsupported' | 'wrong-password' | 'damaged';

export class CryptError extends Error {
  constructor(
    readonly code: CryptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptError';
  }
}

const damaged = () =>
  new CryptError('damaged', 'This file is incomplete or has been modified since it was encrypted, so it can\'t be decrypted safely.');

export interface Header {
  iterations: number;
  chunkSize: number;
  salt: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  keyCheck: Uint8Array<ArrayBuffer>;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface Unlocked {
  header: Header;
  key: CryptoKey;
}

export type Sink = (chunk: Uint8Array<ArrayBuffer>) => unknown;

export interface RunOptions {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export const isEncrypted = (head: Uint8Array) => head.length >= 4 && MAGIC.every((b, i) => head[i] === b);

function writeHeader(iterations: number, chunkSize: number, salt: Uint8Array, nonce: Uint8Array, keyCheck: Uint8Array) {
  const bytes = new Uint8Array(HEADER_SIZE);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  bytes[4] = VERSION;
  bytes[5] = KDF_PBKDF2_SHA256;
  view.setUint32(8, iterations);
  view.setUint32(12, chunkSize);
  bytes.set(salt, 16);
  bytes.set(nonce, 32);
  bytes.set(keyCheck, 44);
  return bytes;
}

export function parseHeader(bytes: Uint8Array): Header {
  if (!isEncrypted(bytes)) throw new CryptError('not-encrypted', 'This isn\'t a file encrypted with Rounder (.rndr).');
  if (bytes.length < HEADER_SIZE) throw damaged();
  if (bytes[4] !== VERSION || bytes[5] !== KDF_PBKDF2_SHA256) {
    throw new CryptError('unsupported', `This .rndr file uses format version ${bytes[4]}, which this page doesn't support yet.`);
  }
  const head = bytes.slice(0, HEADER_SIZE);
  const view = new DataView(head.buffer);
  const iterations = view.getUint32(8);
  const chunkSize = view.getUint32(12);
  // a crafted header could otherwise make us spin for hours or allocate gigabytes
  if (iterations < 1 || iterations > MAX_ITERATIONS || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) throw damaged();
  return {
    iterations,
    chunkSize,
    salt: head.slice(16, 32),
    nonce: head.slice(32, 44),
    keyCheck: head.slice(44, 60),
    bytes: head,
  };
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const subtle = crypto.subtle;
  const base = await subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
  const key = await subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const label = new TextEncoder().encode('RNDR key check');
  const check = new Uint8Array(await subtle.digest('SHA-256', concat(label, bits))).slice(0, 16);
  bits.fill(0);
  return { key, check };
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function chunkIv(nonce: Uint8Array, index: number) {
  const iv = nonce.slice();
  const view = new DataView(iv.buffer);
  view.setUint32(8, view.getUint32(8) ^ index);
  return iv;
}

function chunkAad(header: Uint8Array, index: number, final: boolean) {
  const aad = new Uint8Array(HEADER_SIZE + 5);
  aad.set(header);
  new DataView(aad.buffer).setUint32(HEADER_SIZE, index);
  aad[HEADER_SIZE + 4] = final ? 1 : 0;
  return aad;
}

const read = async (file: Blob, start: number, length: number) => new Uint8Array(await file.slice(start, start + length).arrayBuffer());

/** Size of the .rndr file for a plaintext of `size` bytes */
export const encryptedSize = (size: number, chunkSize = DEFAULT_CHUNK_SIZE) =>
  HEADER_SIZE + Math.max(1, Math.ceil(size / chunkSize)) * TAG_SIZE + size;

/** Encrypts `file` chunk by chunk, handing each piece of the output to `write` in order */
export async function encryptFile(
  file: Blob,
  password: string,
  write: Sink,
  { chunkSize = DEFAULT_CHUNK_SIZE, iterations = DEFAULT_ITERATIONS, onProgress, signal }: RunOptions & { chunkSize?: number; iterations?: number } = {},
) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const { key, check } = await deriveKey(password, salt, iterations);
  const header = writeHeader(iterations, chunkSize, salt, nonce, check);
  await write(header);

  const count = Math.max(1, Math.ceil(file.size / chunkSize));
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted();
    const plain = await read(file, i * chunkSize, chunkSize);
    const sealed = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: chunkIv(nonce, i), additionalData: chunkAad(header, i, i === count - 1) },
      key,
      plain,
    );
    await write(new Uint8Array(sealed));
    onProgress?.(Math.min(file.size, (i + 1) * chunkSize), file.size);
  }
}

/** Reads the header and checks the password, before any output is written */
export async function unlock(file: Blob, password: string): Promise<Unlocked> {
  const header = parseHeader(await read(file, 0, HEADER_SIZE));
  const { key, check } = await deriveKey(password, header.salt, header.iterations);
  if (!check.every((b, i) => b === header.keyCheck[i])) {
    throw new CryptError('wrong-password', 'Wrong password. Check for typos and caps lock, and try again.');
  }
  return { header, key };
}

/**
 * Decrypts chunk by chunk. Each chunk is verified before it is written, but a damaged
 * chunk late in the file is only found when it is reached: on error, throw away the output.
 */
export async function decryptFile(file: Blob, { header, key }: Unlocked, write: Sink, { onProgress, signal }: RunOptions = {}) {
  const block = header.chunkSize + TAG_SIZE;
  const body = file.size - HEADER_SIZE;
  const count = Math.max(1, Math.ceil(body / block));
  if (body - (count - 1) * block < TAG_SIZE) throw damaged();

  const total = body - count * TAG_SIZE;
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted();
    const sealed = await read(file, HEADER_SIZE + i * block, block);
    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: chunkIv(header.nonce, i), additionalData: chunkAad(header.bytes, i, i === count - 1) },
        key,
        sealed,
      );
    } catch {
      throw damaged();
    }
    await write(new Uint8Array(plain));
    onProgress?.(Math.min(total, (i + 1) * header.chunkSize), total);
  }
}

/** "photo.jpg" → "photo.jpg.rndr", and back again (dropping a browser's " (1)" too) */
export function outputName(name: string, mode: 'encrypt' | 'decrypt') {
  if (mode === 'encrypt') return `${name}.${EXTENSION}`;
  const stripped = name.replace(/\.rndr$/i, '');
  if (stripped === name) return `${name}-decrypted`;
  return stripped.replace(/ \(\d+\)$/, '') || 'decrypted';
}

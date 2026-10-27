import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  CryptError,
  decryptFile,
  encryptedSize,
  encryptFile,
  HEADER_SIZE,
  isEncrypted,
  outputName,
  parseHeader,
  TAG_SIZE,
  unlock,
} from '@/tools/lib/file-encryptor/format';

// small chunks and few iterations keep the tests quick; the format is the same at any size
const FAST = { chunkSize: 1000, iterations: 1000 };

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

const randomBytes = (n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, i + 65536));
  return out;
};

async function encrypt(data: Uint8Array, password = 'correct horse', opts = FAST) {
  const parts: Uint8Array[] = [];
  await encryptFile(new Blob([data as Uint8Array<ArrayBuffer>]), password, (c) => parts.push(c), opts);
  return new Uint8Array(await new Blob(parts as Uint8Array<ArrayBuffer>[]).arrayBuffer());
}

async function decrypt(data: Uint8Array, password = 'correct horse') {
  const file = new Blob([data as Uint8Array<ArrayBuffer>]);
  const parts: Uint8Array[] = [];
  await decryptFile(file, await unlock(file, password), (c) => parts.push(c));
  return new Uint8Array(await new Blob(parts as Uint8Array<ArrayBuffer>[]).arrayBuffer());
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CryptError);
    return (err as CryptError).code;
  }
  throw new Error('expected an error');
}

describe('round trip', () => {
  it.each([0, 1, 999, 1000, 1001, 2000, 5432])('restores %i bytes exactly', async (size) => {
    const data = randomBytes(size);
    const sealed = await encrypt(data);
    expect(sealed.length).toBe(encryptedSize(size, FAST.chunkSize));
    expect(same(await decrypt(sealed), data)).toBe(true);
  });

  it('works with the default 600,000 iterations and 4 MB chunks', async () => {
    const data = randomBytes(9 * 1024 * 1024 + 17);
    const sealed = await encrypt(data, 'pässwörd 🔑', {} as typeof FAST);
    const header = parseHeader(sealed);
    expect(header.iterations).toBe(600_000);
    expect(header.chunkSize).toBe(4 * 1024 * 1024);
    expect(same(await decrypt(sealed, 'pässwörd 🔑'), data)).toBe(true);
  }, 30_000);

  it('treats composed and decomposed accents as the same password', async () => {
    const sealed = await encrypt(new Uint8Array([1, 2, 3]), 'café');
    expect(await decrypt(sealed, 'café')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('never produces the same output twice (random salt and nonce)', async () => {
    const data = new Uint8Array(100);
    const [a, b] = await Promise.all([encrypt(data), encrypt(data)]);
    expect(a).not.toEqual(b);
    expect(a.slice(16, 32)).not.toEqual(b.slice(16, 32));
  });
});

describe('header', () => {
  it('starts with the RNDR magic and documented fields', async () => {
    const sealed = await encrypt(new Uint8Array(10));
    expect(new TextDecoder().decode(sealed.slice(0, 4))).toBe('RNDR');
    expect(sealed[4]).toBe(1); // version
    expect(sealed[5]).toBe(1); // PBKDF2-SHA256
    expect(isEncrypted(sealed)).toBe(true);
    const view = new DataView(sealed.buffer);
    expect(view.getUint32(8)).toBe(1000);
    expect(view.getUint32(12)).toBe(1000);
  });

  it('rejects files that are not .rndr', async () => {
    expect(isEncrypted(new TextEncoder().encode('%PDF-1.7'))).toBe(false);
    expect(await codeOf(unlock(new Blob(['hello world, definitely not encrypted at all, long enough to fill a header']), 'x'))).toBe('not-encrypted');
  });

  it('rejects a future version', async () => {
    const sealed = await encrypt(new Uint8Array(10));
    sealed[4] = 2;
    expect(await codeOf(unlock(new Blob([sealed]), 'correct horse'))).toBe('unsupported');
  });

  it('refuses absurd iteration counts instead of hanging', async () => {
    const sealed = await encrypt(new Uint8Array(10));
    new DataView(sealed.buffer).setUint32(8, 0xffffffff);
    expect(await codeOf(unlock(new Blob([sealed]), 'correct horse'))).toBe('damaged');
  });
});

describe('failures', () => {
  it('reports a wrong password before decrypting anything', async () => {
    const sealed = await encrypt(randomBytes(3000));
    expect(await codeOf(unlock(new Blob([sealed]), 'correct horsE'))).toBe('wrong-password');
    expect(await codeOf(unlock(new Blob([sealed]), ''))).toBe('wrong-password');
  });

  it('detects a flipped bit in any chunk', async () => {
    const sealed = await encrypt(randomBytes(3500));
    for (const offset of [HEADER_SIZE, HEADER_SIZE + 1500, sealed.length - 1]) {
      const bad = sealed.slice();
      bad[offset] ^= 1;
      expect(await codeOf(decrypt(bad))).toBe('damaged');
    }
  });

  it('detects a changed chunk size in the header', async () => {
    const sealed = await encrypt(randomBytes(3500));
    new DataView(sealed.buffer).setUint32(12, 1001);
    expect(await codeOf(decrypt(sealed))).toBe('damaged');
  });

  it('detects truncation, mid-chunk and exactly on a chunk boundary', async () => {
    const sealed = await encrypt(randomBytes(3500));
    const block = 1000 + TAG_SIZE;
    for (const cut of [sealed.length - 1, sealed.length - 300, HEADER_SIZE + 2 * block, HEADER_SIZE + block, HEADER_SIZE + 5, 30]) {
      expect(await codeOf(decrypt(sealed.slice(0, cut))), `cut at ${cut}`).toBe('damaged');
    }
  });

  it('detects appended data', async () => {
    const sealed = await encrypt(randomBytes(2000));
    const longer = new Uint8Array(sealed.length + 50);
    longer.set(sealed);
    expect(await codeOf(decrypt(longer))).toBe('damaged');
  });

  it('detects swapped chunks', async () => {
    const sealed = await encrypt(randomBytes(3500));
    const block = 1000 + TAG_SIZE;
    const a = sealed.slice(HEADER_SIZE, HEADER_SIZE + block);
    const b = sealed.slice(HEADER_SIZE + block, HEADER_SIZE + 2 * block);
    const swapped = sealed.slice();
    swapped.set(b, HEADER_SIZE);
    swapped.set(a, HEADER_SIZE + block);
    expect(await codeOf(decrypt(swapped))).toBe('damaged');
  });

  it('detects a dropped middle chunk', async () => {
    const sealed = await encrypt(randomBytes(3500));
    const block = 1000 + TAG_SIZE;
    const dropped = new Uint8Array([...sealed.slice(0, HEADER_SIZE + block), ...sealed.slice(HEADER_SIZE + 2 * block)]);
    expect(await codeOf(decrypt(dropped))).toBe('damaged');
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(encryptFile(new Blob([new Uint8Array(5000)]), 'pw', () => {}, { ...FAST, signal: controller.signal })).rejects.toThrow();
  });
});

describe('outputName', () => {
  it('adds and removes the extension', () => {
    expect(outputName('report.pdf', 'encrypt')).toBe('report.pdf.rndr');
    expect(outputName('report.pdf.rndr', 'decrypt')).toBe('report.pdf');
    expect(outputName('report.pdf (1).rndr', 'decrypt')).toBe('report.pdf');
    expect(outputName('mystery.bin', 'decrypt')).toBe('mystery.bin-decrypted');
  });
});

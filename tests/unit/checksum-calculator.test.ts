import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALGOS, createHasher, parseExpected, type Algo } from '@/tools/lib/checksum-calculator/algorithms';
import { toHex } from '@/tools/lib/checksum-calculator/block';

const enc = new TextEncoder();
const hash = (algo: Algo, data: Uint8Array | string) =>
  toHex(createHasher(algo).update(typeof data === 'string' ? enc.encode(data) : data).digest());

describe('MD5 (RFC 1321 test suite)', () => {
  const vectors: [string, string][] = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
  ];
  it.each(vectors)('md5(%j)', (input, expected) => expect(hash('MD5', input)).toBe(expected));
});

describe('SHA family (NIST FIPS 180 examples)', () => {
  const abc = 'abc';
  const two = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
  const four = 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';

  it('SHA-1', () => {
    expect(hash('SHA-1', abc)).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(hash('SHA-1', two)).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
    expect(hash('SHA-1', '')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('SHA-256', () => {
    expect(hash('SHA-256', abc)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hash('SHA-256', two)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(hash('SHA-256', '')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('SHA-384', () => {
    expect(hash('SHA-384', abc)).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    );
    expect(hash('SHA-384', four)).toBe(
      '09330c33f71147e83d192fc782cd1b4753111b173b3b05d22fa08086e3b0f712fcc7c71a557e2db966c3e9fa91746039',
    );
  });

  it('SHA-512', () => {
    expect(hash('SHA-512', abc)).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
    expect(hash('SHA-512', four)).toBe(
      '8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909',
    );
  });

  it('one million "a" (the long NIST vector) for SHA-256', () => {
    const data = new Uint8Array(1_000_000).fill(0x61);
    expect(hash('SHA-256', data)).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('CRC32', () => {
  it('matches the standard check value', () => {
    expect(hash('CRC32', '123456789')).toBe('cbf43926');
    expect(hash('CRC32', '')).toBe('00000000');
  });
});

describe('incremental hashing', () => {
  // random data at awkward lengths, fed in random-sized pieces, cross-checked against node's OpenSSL
  const nodeName: Partial<Record<Algo, string>> = { MD5: 'md5', 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512' };
  let seed = 7;
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) % n);
  const data = Uint8Array.from({ length: 300_000 }, () => rand(256));

  it.each(ALGOS.filter((a) => a !== 'CRC32'))('%s matches node:crypto across chunk boundaries', (algo) => {
    for (const len of [0, 1, 55, 56, 63, 64, 111, 112, 127, 128, 129, 1000, 300_000]) {
      const slice = data.subarray(0, len);
      const h = createHasher(algo);
      for (let i = 0; i < len; ) {
        const step = 1 + rand(5000);
        h.update(slice.subarray(i, i + step));
        i += step;
      }
      expect(toHex(h.digest()), `${algo} len ${len}`).toBe(createHash(nodeName[algo]!).update(slice).digest('hex'));
    }
  });

  it('CRC32 gives the same result in one go or in pieces', () => {
    const whole = hash('CRC32', data);
    const h = createHasher('CRC32');
    for (let i = 0; i < data.length; i += 4097) h.update(data.subarray(i, i + 4097));
    expect(toHex(h.digest())).toBe(whole);
  });
});

describe('parseExpected', () => {
  it('detects the algorithm from the length', () => {
    expect(parseExpected('D41D8CD98F00B204E9800998ECF8427E')).toEqual({ hex: 'd41d8cd98f00b204e9800998ecf8427e', algo: 'MD5' });
    expect(parseExpected('cbf43926')?.algo).toBe('CRC32');
    expect(parseExpected('a9993e364706816aba3e25717850c26c9cd0d89d')?.algo).toBe('SHA-1');
    expect(parseExpected('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')?.algo).toBe('SHA-256');
  });

  it('reads sha256sum and BSD style lines', () => {
    const h = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(parseExpected(`${h}  ubuntu-24.04-desktop-amd64.iso`)).toEqual({ hex: h, algo: 'SHA-256' });
    expect(parseExpected(`SHA256 (deadbeef.zip) = ${h}`)).toEqual({ hex: h, algo: 'SHA-256' });
  });

  it('reads SRI strings', () => {
    // sha256 of "" in base64
    expect(parseExpected('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')).toEqual({
      hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      algo: 'SHA-256',
    });
  });

  it('rejects things that are not a hash', () => {
    expect(parseExpected('')).toBeNull();
    expect(parseExpected('hello world')).toBeNull();
    expect(parseExpected('abc123')).toBeNull();
    expect(parseExpected('0123456789abcdef0123')).toBeNull();
  });
});

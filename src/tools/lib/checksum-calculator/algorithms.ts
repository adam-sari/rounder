import type { Hasher } from './block';
import { Crc32 } from './crc32';
import { Md5 } from './md5';
import { Sha1, Sha256, Sha512 } from './sha';

export const ALGOS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'CRC32'] as const;
export type Algo = (typeof ALGOS)[number];

/** hex digest length → algorithm, for recognising a pasted checksum */
export const HEX_LENGTH: Record<Algo, number> = { MD5: 32, 'SHA-1': 40, 'SHA-256': 64, 'SHA-384': 96, 'SHA-512': 128, CRC32: 8 };

export function createHasher(algo: Algo): Hasher {
  switch (algo) {
    case 'MD5': return new Md5();
    case 'SHA-1': return new Sha1();
    case 'SHA-256': return new Sha256();
    case 'SHA-384': return new Sha512(true);
    case 'SHA-512': return new Sha512();
    case 'CRC32': return new Crc32();
  }
}

export interface Expected {
  hex: string;
  algo: Algo;
}

const SRI = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/;

/**
 * Pulls a checksum out of whatever was pasted: a bare hash, a line of `sha256sum`
 * output ("hash  file"), BSD style ("SHA256 (file) = hash") or an SRI string ("sha384-…").
 */
export function parseExpected(input: string): Expected | null {
  const text = input.trim();
  const sri = SRI.exec(text);
  if (sri) {
    try {
      const hex = Array.from(atob(sri[2]), (ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      return detect(hex);
    } catch {
      return null;
    }
  }
  const tokens = text.match(/(?<![0-9a-f])[0-9a-f]{8,128}(?![0-9a-f])/gi) ?? [];
  // the longest token is the hash; shorter hex runs are usually part of a file name
  const best = tokens.map((t) => detect(t)).filter((e) => e !== null).sort((a, b) => b.hex.length - a.hex.length)[0];
  return best ?? null;
}

function detect(hex: string): Expected | null {
  const algo = ALGOS.find((a) => HEX_LENGTH[a] === hex.length);
  return algo ? { hex: hex.toLowerCase(), algo } : null;
}

import { base64UrlToBytes, type DecodedJwt } from './jwt';

type Hash = 'SHA-256' | 'SHA-384' | 'SHA-512';

interface AlgSpec {
  kind: 'hmac' | 'public';
  importParams: HmacImportParams | RsaHashedImportParams | EcKeyImportParams | Algorithm;
  verifyParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
  /** what the key has to be, for error messages */
  keyType?: string;
  /** fixed signature length in bytes (ECDSA uses raw r‖s) */
  sigLength?: number;
}

const bits = (alg: string) => alg.slice(2) as '256' | '384' | '512';
const hashOf = (alg: string) => `SHA-${bits(alg)}` as Hash;

export function algorithmSpec(alg: string): AlgSpec | null {
  if (/^HS(256|384|512)$/.test(alg)) {
    return { kind: 'hmac', importParams: { name: 'HMAC', hash: hashOf(alg) }, verifyParams: 'HMAC' };
  }
  if (/^RS(256|384|512)$/.test(alg)) {
    return { kind: 'public', importParams: { name: 'RSASSA-PKCS1-v1_5', hash: hashOf(alg) }, verifyParams: 'RSASSA-PKCS1-v1_5', keyType: 'an RSA public key' };
  }
  if (/^PS(256|384|512)$/.test(alg)) {
    // JWA fixes the salt length to the hash size
    return { kind: 'public', importParams: { name: 'RSA-PSS', hash: hashOf(alg) }, verifyParams: { name: 'RSA-PSS', saltLength: Number(bits(alg)) / 8 }, keyType: 'an RSA public key' };
  }
  const ec = { ES256: ['P-256', 'SHA-256', 64], ES384: ['P-384', 'SHA-384', 96], ES512: ['P-521', 'SHA-512', 132] } as const;
  if (alg in ec) {
    const [namedCurve, hash, sigLength] = ec[alg as keyof typeof ec];
    return { kind: 'public', importParams: { name: 'ECDSA', namedCurve }, verifyParams: { name: 'ECDSA', hash }, keyType: `an EC public key on curve ${namedCurve}`, sigLength };
  }
  if (alg === 'EdDSA' || alg === 'Ed25519') {
    return { kind: 'public', importParams: { name: 'Ed25519' }, verifyParams: { name: 'Ed25519' }, keyType: 'an Ed25519 public key', sigLength: 64 };
  }
  return null;
}

// --- just enough DER to pull a public key out of PKCS#1 keys and X.509 certificates ---

function readTlv(der: Uint8Array, pos: number) {
  const tag = der[pos];
  let len = der[pos + 1];
  let start = pos + 2;
  if (tag === undefined || len === undefined) throw new Error('truncated');
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n > 4) throw new Error('length too long');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (der[start + i] ?? 0);
    start += n;
  }
  if (start + len > der.length) throw new Error('truncated');
  return { tag, start, end: start + len };
}

function derLength(n: number) {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (; n; n >>>= 8) out.unshift(n & 0xff);
  return [0x80 | out.length, ...out];
}

const tlv = (tag: number, body: Uint8Array | number[]) => [tag, ...derLength(body.length), ...body];

// AlgorithmIdentifier for rsaEncryption with NULL parameters
const RSA_ALG_ID = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];

/** wraps a PKCS#1 RSAPublicKey in a SubjectPublicKeyInfo, which WebCrypto can import */
export function pkcs1ToSpki(pkcs1: Uint8Array) {
  return new Uint8Array(tlv(0x30, [...RSA_ALG_ID, ...tlv(0x03, [0x00, ...pkcs1])]));
}

/** the SubjectPublicKeyInfo inside an X.509 certificate */
export function certificateSpki(der: Uint8Array) {
  const cert = readTlv(der, 0);
  const tbs = readTlv(der, cert.start);
  let pos = tbs.start;
  if (der[pos] === 0xa0) pos = readTlv(der, pos).end; // optional [0] version
  // serial, signature algorithm, issuer, validity, subject
  for (let i = 0; i < 5; i++) pos = readTlv(der, pos).end;
  const spki = readTlv(der, pos);
  return der.slice(pos, spki.end);
}

const b64ToBytes = (s: string) => base64UrlToBytes(s.replace(/\s+/g, ''));

export type KeyInput = { format: 'spki'; data: Uint8Array<ArrayBuffer>; note?: string } | { format: 'jwk'; data: JsonWebKey; note?: string };

/** reads a pasted public key: PEM (SPKI, PKCS#1 or certificate), JWK, JWK Set, or bare Base64 SPKI */
export function parsePublicKey(text: string, kid?: unknown): KeyInput {
  const input = text.trim();
  if (input.startsWith('{')) {
    let json: { keys?: unknown } & JsonWebKey;
    try {
      json = JSON.parse(input);
    } catch {
      throw new Error('That looks like JSON but doesn\'t parse. Paste a JWK, a JWK Set, or a PEM public key.');
    }
    let jwk: JsonWebKey & { kid?: string } = json;
    let note: string | undefined;
    if (Array.isArray(json.keys)) {
      const keys = json.keys as (JsonWebKey & { kid?: string })[];
      const match = kid !== undefined ? keys.find((k) => k.kid === kid) : keys[0];
      if (!match) throw new Error(kid !== undefined ? `No key in this set has kid "${String(kid)}".` : 'This key set is empty.');
      jwk = match;
      note = `Using the key with kid "${match.kid ?? '(none)'}" from the set.`;
    }
    if (jwk.d) note = 'This is a private key. Only its public part was used; you only ever need the public key to verify.';
    // keep only the public members so stray alg/use/key_ops fields can't block the import
    const { kty, n, e, crv, x, y } = jwk;
    if (!kty) throw new Error('This JSON has no "kty", so it isn\'t a JWK.');
    if (kty === 'oct') throw new Error('This is a symmetric (oct) key. For HS256/384/512 tokens, enter the secret instead.');
    const pub: JsonWebKey = kty === 'RSA' ? { kty, n, e } : kty === 'EC' ? { kty, crv, x, y } : { kty, crv, x };
    return { format: 'jwk', data: pub, note };
  }

  const pem = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(input);
  if (pem) {
    const [, label = '', body = ''] = pem;
    if (/PRIVATE KEY/.test(label)) {
      throw new Error('That\'s a private key. Verifying only needs the public key (-----BEGIN PUBLIC KEY-----), so keep the private one to yourself.');
    }
    let der: Uint8Array<ArrayBuffer>;
    try {
      der = b64ToBytes(body);
    } catch {
      throw new Error('The PEM block isn\'t valid Base64.');
    }
    if (label === 'PUBLIC KEY') return { format: 'spki', data: der };
    if (label === 'RSA PUBLIC KEY') return { format: 'spki', data: pkcs1ToSpki(der) };
    if (label === 'CERTIFICATE') {
      try {
        return { format: 'spki', data: certificateSpki(der) };
      } catch {
        throw new Error('Couldn\'t read the public key from this certificate.');
      }
    }
    throw new Error(`"${label}" isn't a public key format this tool reads. Paste a PUBLIC KEY, RSA PUBLIC KEY or CERTIFICATE block, or a JWK.`);
  }

  if (/^[A-Za-z0-9+/=_\s-]{60,}$/.test(input)) {
    try {
      return { format: 'spki', data: b64ToBytes(input) };
    } catch {
      // fall through to the general message
    }
  }
  throw new Error('Paste a public key as PEM (-----BEGIN PUBLIC KEY-----), a certificate, a JWK or a JWK Set.');
}

export type VerifyOutcome = { state: 'valid' | 'invalid'; note?: string } | { state: 'error'; message: string };

export interface VerifyKey {
  secret?: string;
  /** the HMAC secret is Base64URL text rather than plain UTF-8 */
  secretIsBase64?: boolean;
  publicKey?: string;
}

/** checks a token's signature with WebCrypto; nothing leaves the device */
export async function verifyJwt(jwt: DecodedJwt, key: VerifyKey): Promise<VerifyOutcome> {
  const alg = String(jwt.header.alg ?? '');
  const spec = algorithmSpec(alg);
  if (!spec) return { state: 'error', message: `${alg || 'This algorithm'} can't be checked with your browser's built-in crypto.` };
  const data = new TextEncoder().encode(`${jwt.raw[0]}.${jwt.raw[1]}`);

  let cryptoKey: CryptoKey;
  let note: string | undefined;
  if (spec.kind === 'hmac') {
    let raw: Uint8Array<ArrayBuffer>;
    try {
      raw = key.secretIsBase64 ? base64UrlToBytes((key.secret ?? '').trim()) : new TextEncoder().encode(key.secret ?? '');
    } catch {
      return { state: 'error', message: 'The secret isn\'t valid Base64URL. Turn off "Base64URL-encoded" if it\'s plain text.' };
    }
    if (!raw.length) return { state: 'error', message: 'Enter the secret.' };
    cryptoKey = await crypto.subtle.importKey('raw', raw, spec.importParams, false, ['verify']);
  } else {
    if (spec.sigLength && jwt.signature.length !== spec.sigLength) {
      return { state: 'invalid', note: `The signature is ${jwt.signature.length} bytes but ${alg} signatures are ${spec.sigLength}. It may be DER-encoded or truncated.` };
    }
    let input: KeyInput;
    try {
      input = parsePublicKey(key.publicKey ?? '', jwt.header.kid);
    } catch (e) {
      return { state: 'error', message: (e as Error).message };
    }
    note = input.note;
    try {
      cryptoKey = input.format === 'jwk'
        ? await crypto.subtle.importKey('jwk', input.data, spec.importParams, false, ['verify'])
        : await crypto.subtle.importKey('spki', input.data, spec.importParams, false, ['verify']);
    } catch (e) {
      if ((e as Error)?.name === 'NotSupportedError') return { state: 'error', message: `Your browser can't verify ${alg} signatures.` };
      return { state: 'error', message: `This key can't verify ${alg}. It needs to be ${spec.keyType}.` };
    }
  }
  const ok = await crypto.subtle.verify(spec.verifyParams, cryptoKey, jwt.signature, data);
  return { state: ok ? 'valid' : 'invalid', note };
}

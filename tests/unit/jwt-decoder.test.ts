import { createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeJwt,
  formatDuration,
  jsonTokens,
  makeExampleToken,
  relativeTime,
  tokenSegments,
  tokenStatus,
  type DecodedJwt,
} from '@/tools/lib/jwt-decoder/jwt';
import { certificateSpki, parsePublicKey, verifyJwt } from '@/tools/lib/jwt-decoder/verify';

const enc = new TextEncoder();
const b64url = (v: unknown) => bytesToBase64Url(enc.encode(JSON.stringify(v)));
const toPem = (der: ArrayBuffer, label = 'PUBLIC KEY') =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END ${label}-----`;

function decoded(token: string): DecodedJwt {
  const r = decodeJwt(token);
  if (!r.ok) throw new Error(r.error);
  return r.jwt;
}

async function signToken(alg: string, signParams: AlgorithmIdentifier | RsaPssParams | EcdsaParams, key: CryptoKey, header: Record<string, unknown> = {}) {
  const input = `${b64url({ alg, typ: 'JWT', ...header })}.${b64url({ sub: '42', iat: 1700000000 })}`;
  const sig = new Uint8Array(await crypto.subtle.sign(signParams, key, enc.encode(input)));
  return `${input}.${bytesToBase64Url(sig)}`;
}

describe('decoding', () => {
  // the classic example token from RFC 7519 style docs
  const token =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  it('decodes header and payload', () => {
    const jwt = decoded(token);
    expect(jwt.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(jwt.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
    expect(jwt.signature.length).toBe(32);
  });

  it('accepts a Bearer prefix and wrapped lines', () => {
    expect(decoded(`Bearer ${token.slice(0, 40)}\n${token.slice(40)}`).header.alg).toBe('HS256');
  });

  it('decodes UTF-8 payloads', () => {
    expect(decoded(`${b64url({ alg: 'none' })}.${b64url({ name: 'Zoë 東京' })}.`).payload).toEqual({ name: 'Zoë 東京' });
  });

  it('keeps a non-JSON payload as text', () => {
    const jwt = decoded(`${b64url({ alg: 'none' })}.${bytesToBase64Url(enc.encode('hello'))}.`);
    expect(jwt.payloadIsJson).toBe(false);
    expect(jwt.payload).toBe('hello');
  });

  it('explains wrong shapes', () => {
    const two = decodeJwt('abc.def');
    expect(two.ok).toBe(false);
    expect(!two.ok && two.error).toMatch(/three parts.*has 2/);
    const jwe = decodeJwt('a.b.c.d.e');
    expect(!jwe.ok && jwe.error).toMatch(/JWE/);
    const bad = decodeJwt('not-json.e30.');
    expect(!bad.ok && bad.error).toMatch(/header/);
  });

  it('round-trips Base64URL', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);
    expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    expect(() => base64UrlToBytes('a')).toThrow();
  });
});

describe('overlay segments', () => {
  it('keeps every character and labels the parts', () => {
    const input = 'Bearer aa.bb.cc';
    const segs = tokenSegments(input);
    expect(segs.map((s) => s.text).join('')).toBe(input);
    expect(segs.map((s) => s.part)).toEqual(['prefix', 'header', 'dot', 'payload', 'dot', 'signature']);
  });

  it('marks parts past the third as extra', () => {
    expect(tokenSegments('a.b.c.d').at(-1)).toEqual({ text: 'd', part: 'extra' });
  });
});

describe('json tokens', () => {
  it('splits keys, strings, numbers and literals', () => {
    const json = JSON.stringify({ a: 'x "q"', n: -1.5e3, t: true, z: null }, null, 2);
    const tokens = jsonTokens(json);
    expect(tokens.map((t) => t.text).join('')).toBe(json);
    expect(tokens.filter((t) => t.kind === 'key').map((t) => t.text)).toEqual(['"a"', '"n"', '"t"', '"z"']);
    expect(tokens.find((t) => t.kind === 'string')?.text).toBe('"x \\"q\\""');
    expect(tokens.filter((t) => t.kind === 'literal').map((t) => t.text)).toEqual(['true', 'null']);
    expect(tokens.find((t) => t.kind === 'number')?.text).toBe('-1500');
  });
});

describe('time', () => {
  it('works out the status from exp and nbf', () => {
    expect(tokenStatus({ exp: 100 }, 100)).toEqual({ state: 'expired', at: 100 });
    expect(tokenStatus({ exp: 200, nbf: 150 }, 100)).toEqual({ state: 'not-yet', at: 150 });
    expect(tokenStatus({ exp: 200 }, 100)).toEqual({ state: 'active', at: 200 });
    expect(tokenStatus({ sub: 'x' }, 100)).toEqual({ state: 'no-expiry' });
    expect(tokenStatus('text', 100)).toEqual({ state: 'no-expiry' });
  });

  it('formats relative times', () => {
    expect(relativeTime(3599)).toBe('in 59 minutes');
    expect(relativeTime(-2 * 86400)).toBe('2 days ago');
    expect(relativeTime(0.2)).toBe('just now');
  });

  it('formats durations', () => {
    expect(formatDuration(3600)).toBe('1 hour');
    expect(formatDuration(86400 * 2 + 3 * 3600 + 5)).toBe('2 days 3 hours');
    expect(formatDuration(90)).toBe('1 minute 30 seconds');
  });
});

describe('signature verification', () => {
  it('verifies the generated HS256 example and rejects a wrong secret', async () => {
    const jwt = decoded(await makeExampleToken('s3cret', 1700000000));
    expect(jwt.payload).toMatchObject({ iat: 1700000000, exp: 1700003600 });
    expect(await verifyJwt(jwt, { secret: 's3cret' })).toEqual({ state: 'valid', note: undefined });
    expect((await verifyJwt(jwt, { secret: 'nope' })).state).toBe('invalid');
    expect((await verifyJwt(jwt, { secret: '' })).state).toBe('error');
  });

  it('accepts a Base64URL secret', async () => {
    const secret = bytesToBase64Url(enc.encode('s3cret'));
    const jwt = decoded(await makeExampleToken('s3cret', 1));
    expect((await verifyJwt(jwt, { secret, secretIsBase64: true })).state).toBe('valid');
  });

  it('verifies RS256 with SPKI PEM, PKCS#1 PEM, JWK and a JWK Set', async () => {
    const params = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwt = decoded(await signToken('RS256', 'RSASSA-PKCS1-v1_5', pair.privateKey, { kid: 'k2' }));
    const spkiPem = toPem(await crypto.subtle.exportKey('spki', pair.publicKey));
    const pkcs1Pem = createPublicKey(spkiPem).export({ type: 'pkcs1', format: 'pem' }).toString();
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

    expect((await verifyJwt(jwt, { publicKey: spkiPem })).state).toBe('valid');
    expect((await verifyJwt(jwt, { publicKey: pkcs1Pem })).state).toBe('valid');
    expect((await verifyJwt(jwt, { publicKey: JSON.stringify(jwk) })).state).toBe('valid');
    const set = await verifyJwt(jwt, { publicKey: JSON.stringify({ keys: [{ kid: 'k1', kty: 'RSA', n: 'AQAB', e: 'AQAB' }, { ...jwk, kid: 'k2' }] }) });
    expect(set).toEqual({ state: 'valid', note: expect.stringMatching(/k2/) });
    const fromPrivate = await verifyJwt(jwt, { publicKey: JSON.stringify(privateJwk) });
    expect(fromPrivate).toEqual({ state: 'valid', note: expect.stringMatching(/private/) });
  });

  it('rejects private PEM keys and keys of the wrong type', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwt = decoded(await signToken('RS256', { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey));
    const r = await verifyJwt(jwt, { publicKey: toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey), 'PRIVATE KEY') });
    expect(r).toEqual({ state: 'error', message: expect.stringMatching(/private key/) });
    const wrong = await verifyJwt(jwt, { publicKey: toPem(await crypto.subtle.exportKey('spki', pair.publicKey)) });
    expect(wrong).toEqual({ state: 'error', message: expect.stringMatching(/RSA public key/) });
  });

  it('verifies PS256, ES256, ES384 and EdDSA', async () => {
    const rsa = (await crypto.subtle.generateKey({ name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const ps = decoded(await signToken('PS256', { name: 'RSA-PSS', saltLength: 32 }, rsa.privateKey));
    expect((await verifyJwt(ps, { publicKey: toPem(await crypto.subtle.exportKey('spki', rsa.publicKey)) })).state).toBe('valid');

    for (const [alg, curve, hash] of [['ES256', 'P-256', 'SHA-256'], ['ES384', 'P-384', 'SHA-384']] as const) {
      const ec = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, ['sign', 'verify'])) as CryptoKeyPair;
      const jwt = decoded(await signToken(alg, { name: 'ECDSA', hash }, ec.privateKey));
      expect((await verifyJwt(jwt, { publicKey: toPem(await crypto.subtle.exportKey('spki', ec.publicKey)) })).state).toBe('valid');
      expect((await verifyJwt(jwt, { publicKey: JSON.stringify(await crypto.subtle.exportKey('jwk', ec.publicKey)) })).state).toBe('valid');
    }

    const ed = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const edJwt = decoded(await signToken('EdDSA', { name: 'Ed25519' }, ed.privateKey));
    expect((await verifyJwt(edJwt, { publicKey: toPem(await crypto.subtle.exportKey('spki', ed.publicKey)) })).state).toBe('valid');
  });

  it('flags a tampered payload as invalid', async () => {
    const jwt = decoded(await makeExampleToken('k', 1));
    const tampered = { ...jwt, raw: [jwt.raw[0], b64url({ sub: 'admin' }), jwt.raw[2]] as [string, string, string] };
    expect((await verifyJwt(tampered, { secret: 'k' })).state).toBe('invalid');
  });

  it('explains unsupported algorithms', async () => {
    const jwt = decoded(`${b64url({ alg: 'ES256K' })}.${b64url({})}.`);
    expect(await verifyJwt(jwt, {})).toEqual({ state: 'error', message: expect.stringMatching(/ES256K/) });
  });
});

describe('public key parsing', () => {
  it('pulls the SPKI out of a certificate', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    // a structurally valid (unsigned) certificate around the key
    const tlv = (tag: number, body: number[]) => [tag, ...(body.length < 128 ? [body.length] : [0x81, body.length]), ...body];
    const seq = (...items: number[][]) => tlv(0x30, items.flat());
    const tbs = seq(tlv(0xa0, tlv(0x02, [2])), tlv(0x02, [1]), seq(tlv(0x06, [0x2a])), seq(), seq(), seq(), [...spki]);
    const cert = new Uint8Array(seq(tbs, seq(tlv(0x06, [0x2a])), tlv(0x03, [0])));
    expect(certificateSpki(cert)).toEqual(spki);
    const parsed = parsePublicKey(toPem(cert.buffer, 'CERTIFICATE'));
    expect(parsed.format).toBe('spki');
  });

  it('gives a clear message for junk', () => {
    expect(() => parsePublicKey('hello')).toThrow(/PEM/);
    expect(() => parsePublicKey('{"kty":"oct","k":"abc"}')).toThrow(/secret/);
  });
});

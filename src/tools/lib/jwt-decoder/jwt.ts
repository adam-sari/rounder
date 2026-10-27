export type TokenPart = 'prefix' | 'header' | 'payload' | 'signature' | 'dot' | 'extra';

export interface DecodedJwt {
  /** the three encoded parts */
  raw: [string, string, string];
  header: Record<string, unknown>;
  /** parsed JSON, or the decoded text when the payload isn't JSON */
  payload: unknown;
  payloadIsJson: boolean;
  signature: Uint8Array<ArrayBuffer>;
}

export type DecodeResult = { ok: true; jwt: DecodedJwt } | { ok: false; error: string };

/** strips whitespace (tokens copied from wrapped logs) and a leading "Bearer " */
export const cleanToken = (input: string) => input.trim().replace(/^bearer\s+/i, '').replace(/\s+/g, '');

export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  // lenient: accept standard Base64 and padding too
  if (!/^[A-Za-z0-9_+/-]*={0,2}$/.test(s)) throw new Error('not Base64URL');
  let b = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (b.length % 4 === 1) throw new Error('not Base64URL');
  b += '='.repeat((4 - (b.length % 4)) % 4);
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function decodeJwt(input: string): DecodeResult {
  const token = cleanToken(input);
  const parts = token.split('.');
  if (parts.length === 5) {
    return { ok: false, error: 'This is an encrypted token (JWE). Its contents can only be read with the recipient\'s private key, so there is nothing to decode here.' };
  }
  if (parts.length !== 3) {
    return { ok: false, error: `A JWT has three parts separated by dots: header.payload.signature. This one has ${parts.length}.` };
  }
  const [h, p, s] = parts as [string, string, string];

  let header: unknown;
  try {
    header = JSON.parse(utf8(base64UrlToBytes(h)));
  } catch {
    return { ok: false, error: 'The header (the part before the first dot) doesn\'t decode to JSON. Check that the whole token was copied.' };
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    return { ok: false, error: 'The header should be a JSON object like {"alg":"HS256","typ":"JWT"}.' };
  }

  let payloadText: string;
  try {
    payloadText = utf8(base64UrlToBytes(p));
  } catch {
    return { ok: false, error: 'The payload (the middle part) isn\'t valid Base64URL. Check that the whole token was copied.' };
  }
  let payload: unknown = payloadText;
  let payloadIsJson = false;
  try {
    payload = JSON.parse(payloadText);
    payloadIsJson = true;
  } catch {
    // some tokens carry plain text or binary; show it as is
  }

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = base64UrlToBytes(s);
  } catch {
    return { ok: false, error: 'The signature (the last part) isn\'t valid Base64URL. Check that the whole token was copied.' };
  }

  return { ok: true, jwt: { raw: [h, p, s], header: header as Record<string, unknown>, payload, payloadIsJson, signature } };
}

/** splits the raw input into colored runs without changing a single character, for the input overlay */
export function tokenSegments(input: string): { text: string; part: TokenPart }[] {
  const out: { text: string; part: TokenPart }[] = [];
  const prefix = /^\s*(?:bearer\s+)?/i.exec(input)![0];
  if (prefix) out.push({ text: prefix, part: 'prefix' });
  const order: TokenPart[] = ['header', 'payload', 'signature'];
  let dots = 0;
  let run = '';
  const flush = () => {
    if (run) out.push({ text: run, part: order[dots] ?? 'extra' });
    run = '';
  };
  for (const ch of input.slice(prefix.length)) {
    if (ch === '.') {
      flush();
      out.push({ text: '.', part: 'dot' });
      dots++;
    } else run += ch;
  }
  flush();
  return out;
}

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct';

/** tokenizes JSON.stringify output for syntax coloring */
export function jsonTokens(json: string): { text: string; kind: JsonTokenKind }[] {
  const out: { text: string; kind: JsonTokenKind }[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  for (const m of json.matchAll(re)) {
    if (m.index > last) out.push({ text: json.slice(last, m.index), kind: 'punct' });
    if (m[1]) {
      out.push({ text: m[1], kind: m[2] ? 'key' : 'string' });
      if (m[2]) out.push({ text: m[2], kind: 'punct' });
    } else out.push({ text: m[0], kind: /^[tfn]/.test(m[0]) ? 'literal' : 'number' });
    last = m.index + m[0].length;
  }
  if (last < json.length) out.push({ text: json.slice(last), kind: 'punct' });
  return out;
}

/** registered and common claims whose value is a NumericDate (seconds since 1970) */
export const TIME_CLAIMS: Record<string, string> = {
  exp: 'Expires',
  nbf: 'Not valid before',
  iat: 'Issued',
  auth_time: 'Signed in',
  updated_at: 'Profile updated',
};

export const CLAIM_INFO: Record<string, string> = {
  iss: 'Issuer: who created the token',
  sub: 'Subject: who the token is about, usually a user ID',
  aud: 'Audience: who the token is meant for',
  exp: 'Expiration time',
  nbf: 'Not before: the token is invalid until this time',
  iat: 'Issued at',
  jti: 'JWT ID: a unique identifier for this token',
  name: 'Full name',
  given_name: 'First name',
  family_name: 'Last name',
  nickname: 'Nickname',
  preferred_username: 'Preferred username',
  email: 'Email address',
  email_verified: 'Whether the email address was verified',
  phone_number: 'Phone number',
  picture: 'Profile picture URL',
  locale: 'Language and region',
  zoneinfo: 'Time zone',
  updated_at: 'When the profile was last updated',
  nonce: 'Nonce: ties the token to a sign-in request',
  azp: 'Authorized party: the client the token was issued to',
  auth_time: 'When the user signed in',
  acr: 'Authentication context class',
  amr: 'Authentication methods used',
  at_hash: 'Access token hash',
  c_hash: 'Authorization code hash',
  sid: 'Session ID',
  scope: 'Scopes granted',
  scp: 'Scopes granted',
  client_id: 'Client ID',
  roles: 'Roles',
  groups: 'Groups',
  tid: 'Tenant ID',
  oid: 'Object ID',
  upn: 'User principal name',
  // header
  alg: 'Signing algorithm',
  typ: 'Token type',
  kid: 'Key ID: which key signed the token',
  cty: 'Content type',
  jku: 'JWK Set URL',
  jwk: 'Embedded public key',
  x5u: 'X.509 certificate URL',
  x5c: 'X.509 certificate chain',
  x5t: 'Certificate thumbprint (SHA-1)',
  'x5t#S256': 'Certificate thumbprint (SHA-256)',
  crit: 'Extensions the receiver must understand',
};

export const isNumericDate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type TokenStatus =
  | { state: 'expired'; at: number }
  | { state: 'not-yet'; at: number }
  | { state: 'active'; at: number }
  | { state: 'no-expiry' };

/** where the token stands right now, going by exp and nbf (all in seconds) */
export function tokenStatus(payload: unknown, now: number): TokenStatus {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  // RFC 7519: a token must not be accepted on or after exp
  if (isNumericDate(p.exp) && now >= p.exp) return { state: 'expired', at: p.exp };
  if (isNumericDate(p.nbf) && now < p.nbf) return { state: 'not-yet', at: p.nbf };
  if (isNumericDate(p.exp)) return { state: 'active', at: p.exp };
  return { state: 'no-expiry' };
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** "in 3 hours", "2 days ago"; floors so 59m59s reads as 59 minutes, not 60 */
export function relativeTime(deltaSeconds: number) {
  const abs = Math.abs(deltaSeconds);
  if (abs < 1) return 'just now';
  const [unit, size] = UNITS.find(([, s]) => abs >= s)!;
  return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(Math.sign(deltaSeconds) * Math.floor(abs / size), unit);
}

/** "1 hour", "2 days 3 hours": the two largest units */
export function formatDuration(seconds: number) {
  let rest = Math.round(Math.abs(seconds));
  if (rest === 0) return '0 seconds';
  const parts: string[] = [];
  for (const [unit, size] of UNITS) {
    const n = Math.floor(rest / size);
    if (n) {
      parts.push(`${n} ${unit}${n === 1 ? '' : 's'}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

/** an HS256 token signed now and valid for an hour, so the example shows live dates and a passing check */
export async function makeExampleToken(secret: string, now: number) {
  const enc = new TextEncoder();
  const part = (v: unknown) => bytesToBase64Url(enc.encode(JSON.stringify(v)));
  const input = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({
    sub: 'user_8127',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    roles: ['editor'],
    iat: now,
    exp: now + 3600,
  })}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${input}.${bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(input))))}`;
}

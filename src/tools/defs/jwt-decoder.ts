import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'jwt-decoder',
  category: 'dev',
  name: 'JWT decoder',
  title: 'JWT Decoder & Verifier: decode tokens and check signatures',
  h1: 'JWT *decoder*',
  description: 'Decode a JSON Web Token to see its header, payload and expiry in plain English, and verify HS, RS, PS, ES or EdDSA signatures. Never sent anywhere.',
  tagline: 'See what\'s inside a token, when it expires, and whether its signature holds up.',
  keywords: ['jwt decode', 'decode jwt token', 'jwt verify signature', 'json web token decoder', 'jwt parser', 'jwt expiration checker', 'bearer token decoder', 'jwt claims viewer'],
  island: 'JwtDecoder',
  steps: [
    'Paste a token. A "Bearer " prefix and line breaks are fine.',
    'Read the color-coded header and payload, with dates turned into local time and an expiry badge.',
    'To check the signature, enter the secret (HS256/384/512) or paste the public key as PEM, certificate or JWK.',
  ],
  faq: [
    {
      q: 'Is it safe to paste a real token here?',
      a: 'Decoding and verification run in your browser with its built-in Web Crypto. The token, secret and key are never sent anywhere. Even so, treat live tokens like passwords and prefer expired or test tokens when you can.',
    },
    {
      q: 'Does decoding prove a token is genuine?',
      a: 'No. The header and payload are only Base64URL-encoded, so anyone can read them and anyone can write new ones. Only a signature check with the right secret or public key shows that the token was issued by whoever holds that key and hasn\'t been changed.',
    },
    {
      q: 'Which algorithms can it verify?',
      a: 'HS256, HS384 and HS512 with a shared secret; RS256/384/512 and PS256/384/512 with an RSA public key; ES256, ES384 and ES512 with an EC public key; and EdDSA (Ed25519) in browsers that support it. Keys can be PEM (PUBLIC KEY, RSA PUBLIC KEY or CERTIFICATE), a JWK, or a JWK Set, in which case the key matching the token\'s kid is used.',
    },
    {
      q: 'What do exp, iat and nbf mean?',
      a: 'They are times in seconds since January 1, 1970 (UTC). exp is when the token expires, iat when it was issued, and nbf the time before which it must not be accepted. They are shown here in your local time with how long ago or how soon each one is.',
    },
    privacyFaq,
  ],
  related: ['base64', 'json-formatter', 'hash-generator', 'regex-tester'],
} satisfies Tool;

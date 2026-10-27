import type { CategoryId } from './categories';
import { privacyFaq, type Tool } from './types';

export type { Faq, Tool } from './types';

// Tools added in batches live in ./defs, one file per tool (default export: a tool or a list of tools).
const defs = import.meta.glob<{ default: Tool | Tool[] }>('./defs/*.ts', { eager: true });

const core: Tool[] = [
  // text
  {
    slug: 'word-counter',
    category: 'text',
    name: 'Word counter',
    title: 'Word Counter: count words, characters & reading time',
    h1: 'Word *counter*',
    description: 'Free word counter. Count words, characters, sentences, paragraphs and reading time as you type. No sign-up, nothing uploaded.',
    tagline: 'Words, characters, sentences and reading time, live as you type.',
    keywords: ['character count', 'letter count', 'reading time', 'essay length'],
    island: 'WordCounter',
    steps: ['Type or paste your text into the box.', 'Counts update instantly as you write.', 'Check the keyword density list to spot overused words.'],
    faq: [
      { q: 'How is reading time calculated?', a: 'We use an average silent reading speed of 238 words per minute and a speaking speed of 140 words per minute.' },
      { q: 'Does it count characters with and without spaces?', a: 'Yes, both are shown side by side.' },
      privacyFaq,
    ],
    related: ['case-converter', 'remove-duplicate-lines'],
  },
  {
    slug: 'case-converter',
    category: 'text',
    name: 'Case converter',
    title: 'Case Converter: UPPERCASE, lowercase, Title Case & more',
    h1: 'Case *converter*',
    description: 'Convert text to UPPERCASE, lowercase, Title Case, Sentence case, camelCase, snake_case, kebab-case and more in one click.',
    tagline: 'Upper, lower, title, sentence, camel, snake and kebab case.',
    keywords: ['uppercase', 'lowercase', 'title case', 'camelcase', 'snake case', 'capitalize'],
    island: 'CaseConverter',
    steps: ['Paste your text.', 'Pick the case you want.', 'Copy the result.'],
    faq: [
      { q: 'What does Title Case do with small words?', a: 'Short words like "a", "of" and "the" stay lowercase unless they start the title, following common style guides.' },
      privacyFaq,
    ],
    related: ['word-counter', 'remove-duplicate-lines'],
  },
  {
    slug: 'remove-duplicate-lines',
    category: 'text',
    name: 'Remove duplicate lines',
    title: 'Remove Duplicate Lines, Sort & Clean Up Lists',
    h1: 'Remove duplicate *lines*',
    description: 'Remove duplicate lines, sort lists alphabetically, trim whitespace and drop empty lines. Free and instant.',
    tagline: 'Dedupe, sort, trim and tidy any list.',
    keywords: ['dedupe', 'sort lines', 'unique lines', 'alphabetize', 'list cleaner'],
    island: 'LineTools',
    steps: ['Paste your list, one item per line.', 'Choose what to clean up.', 'Copy the tidy result.'],
    faq: [
      { q: 'Is the comparison case-sensitive?', a: 'By default yes. Turn on "ignore case" to treat "Apple" and "apple" as duplicates.' },
      privacyFaq,
    ],
    related: ['word-counter', 'case-converter'],
  },

  // dev
  {
    slug: 'json-formatter',
    category: 'dev',
    name: 'JSON formatter',
    title: 'JSON Formatter & Validator: beautify or minify JSON',
    h1: 'JSON *formatter*',
    description: 'Format, validate and minify JSON instantly. Clear error messages with line numbers. Your JSON never leaves your browser.',
    tagline: 'Beautify, validate and minify JSON with clear errors.',
    keywords: ['json beautifier', 'json validator', 'json minify', 'pretty print json', 'json lint'],
    island: 'JsonFormatter',
    steps: ['Paste your JSON.', 'Choose an indent size, or minify.', 'Fix any error using the line and column shown, then copy.'],
    faq: [
      { q: 'Is it safe to paste API responses or config with secrets?', a: 'Yes. Formatting happens locally in your browser, and nothing is sent anywhere.' },
      privacyFaq,
    ],
    related: ['base64', 'url-encode'],
  },
  {
    slug: 'base64',
    category: 'dev',
    name: 'Base64 encode / decode',
    title: 'Base64 Encode & Decode: text and files',
    h1: 'Base64 *encode & decode*',
    description: 'Encode text or files to Base64 and decode Base64 back to text. Supports UTF-8 and URL-safe Base64.',
    tagline: 'Text or files to Base64 and back, UTF-8 safe.',
    keywords: ['base64 encoder', 'base64 decoder', 'data uri', 'btoa', 'atob'],
    island: 'Base64',
    steps: ['Choose encode or decode.', 'Paste text or drop a file.', 'Copy the result.'],
    faq: [
      { q: 'What is URL-safe Base64?', a: 'It swaps "+" and "/" for "-" and "_" and drops padding, so the result can sit in a URL without escaping.' },
      privacyFaq,
    ],
    related: ['url-encode', 'hash-generator'],
  },
  {
    slug: 'url-encode',
    category: 'dev',
    name: 'URL encode / decode',
    title: 'URL Encode & Decode: percent-encoding online',
    h1: 'URL *encode & decode*',
    description: 'Percent-encode or decode URLs and query strings. Also breaks a URL into its parts and query parameters.',
    tagline: 'Percent-encode, decode and inspect URLs.',
    keywords: ['percent encoding', 'urlencode', 'urldecode', 'query string', 'url parser'],
    island: 'UrlEncode',
    steps: ['Paste a URL or text.', 'Choose encode or decode.', 'Inspect the parsed parts and copy.'],
    faq: [
      { q: 'Component or full URL?', a: '"Component" encodes every reserved character (for a single query value). "Full URL" keeps characters like ":" and "/" so the URL stays usable.' },
      privacyFaq,
    ],
    related: ['base64', 'json-formatter'],
  },
  {
    slug: 'uuid-generator',
    category: 'dev',
    name: 'UUID generator',
    title: 'UUID Generator: v4 and v7 UUIDs in bulk',
    h1: 'UUID *generator*',
    description: 'Generate random v4 or time-ordered v7 UUIDs, one or a thousand at a time, using your browser\'s secure random generator.',
    tagline: 'v4 and v7 UUIDs, one or a thousand at a time.',
    keywords: ['guid', 'uuid v4', 'uuid v7', 'random id', 'unique id'],
    island: 'UuidGenerator',
    steps: ['Pick the version and how many you need.', 'Generate.', 'Copy them all at once.'],
    faq: [
      { q: 'v4 or v7?', a: 'v4 is fully random. v7 starts with a timestamp, so IDs sort by creation time, which is friendlier for database indexes.' },
      privacyFaq,
    ],
    related: ['hash-generator', 'password-generator'],
  },
  {
    slug: 'hash-generator',
    category: 'dev',
    name: 'Hash generator',
    title: 'Hash Generator: SHA-256, SHA-512, SHA-1 for text & files',
    h1: 'Hash *generator*',
    description: 'Generate SHA-256, SHA-384, SHA-512 and SHA-1 hashes of text or files, and verify file checksums. Runs locally.',
    tagline: 'SHA hashes of text or files, plus checksum verification.',
    keywords: ['sha256', 'sha512', 'checksum', 'file hash', 'verify download'],
    island: 'HashGenerator',
    steps: ['Type text or drop a file.', 'All hashes are calculated at once.', 'Paste an expected checksum to verify it matches.'],
    faq: [
      { q: 'Can I verify a download?', a: 'Yes. Drop the file, paste the checksum from the publisher\'s site, and we will tell you whether it matches.' },
      privacyFaq,
    ],
    related: ['checksum-calculator', 'uuid-generator', 'base64', 'file-encryptor'],
  },

  // files & privacy
  {
    slug: 'password-generator',
    category: 'files',
    name: 'Password generator',
    title: 'Password Generator: strong random passwords & passphrases',
    h1: 'Password *generator*',
    description: 'Generate strong random passwords or memorable passphrases with your browser\'s secure random generator. Shows strength and crack time.',
    tagline: 'Strong passwords and passphrases, generated on your device.',
    keywords: ['random password', 'passphrase', 'strong password', 'secure password'],
    island: 'PasswordGenerator',
    steps: ['Pick a password or a passphrase.', 'Adjust the length and characters.', 'Copy it into your password manager.'],
    faq: [
      { q: 'Are these passwords really random?', a: 'Yes. They come from crypto.getRandomValues, the same secure generator browsers use for encryption, and they are never sent anywhere.' },
      privacyFaq,
    ],
    related: ['password-strength-checker', 'file-encryptor', 'hash-generator', 'uuid-generator'],
  },

  // everyday
  {
    slug: 'qr-code-generator',
    category: 'everyday',
    name: 'QR code generator',
    title: 'QR Code Generator with logo: free, no expiry, no sign-up',
    h1: 'QR code *generator*',
    description: 'Make QR codes for links, Wi-Fi, text, email and contacts. Add your logo and colors, download PNG or SVG. Codes never expire.',
    tagline: 'Links, Wi-Fi, contacts. Custom colors and logo. Never expires.',
    keywords: ['qr code', 'wifi qr', 'qr with logo', 'qr svg', 'vcard qr'],
    island: 'QrGenerator',
    steps: ['Choose what the code should contain.', 'Style it with colors and an optional logo.', 'Download as PNG or SVG.'],
    faq: [
      { q: 'Will my QR code stop working?', a: 'Never. Many "free" generators make dynamic codes that redirect through their servers and expire after a trial. Ours encode your content directly, so they work forever.' },
      { q: 'Can I add a logo?', a: 'Yes. We use high error correction so the code still scans with a logo in the middle. Always test-scan before printing.' },
      privacyFaq,
    ],
    related: ['password-generator', 'uuid-generator'],
    flagship: { elsewhere: 'Codes that expire after a 14-day trial', here: 'Static codes that never expire' },
  },
];

export const tools: Tool[] = [...core, ...Object.values(defs).flatMap((m) => [m.default].flat())];

export const toolBySlug = Object.fromEntries(tools.map((t) => [t.slug, t])) as Record<string, Tool>;

/** main tools in a category, without variant pages */
export const toolsIn = (category: CategoryId) => tools.filter((t) => t.category === category && !t.variantOf);

/** variant pages that share an island with the given tool */
export const variantsOf = (slug: string) => tools.filter((t) => t.variantOf === slug);

/** Splits "Word *counter*" into plain and emphasised parts for rendering */
export function splitEmphasis(text: string): { text: string; em: boolean }[] {
  return text.split(/(\*[^*]+\*)/).filter(Boolean).map((part) =>
    part.startsWith('*') ? { text: part.slice(1, -1), em: true } : { text: part, em: false },
  );
}

export const plainText = (text: string) => text.replaceAll('*', '');

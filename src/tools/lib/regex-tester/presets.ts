export interface Preset {
  name: string;
  pattern: string;
  flags: string;
  sample: string;
}

// Practical patterns, not RFC-complete validators; each sample shows hits and near misses.
export const PRESETS: Preset[] = [
  {
    name: 'Email address',
    pattern: String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`,
    flags: 'g',
    sample: 'Write to ada@example.com or ops.team+alerts@mail.rounder.dev.\nNot an address: ada@localhost',
  },
  {
    name: 'URL',
    pattern: String.raw`https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]`,
    flags: 'g',
    sample: 'Docs live at https://roundertools.com/regex-tester.\nOld link: http://example.org/path?q=1&x=2, still works.',
  },
  {
    name: 'IPv4 address',
    pattern: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b`,
    flags: 'g',
    sample: 'Server 192.168.1.20 talks to 10.0.0.1.\n256.1.1.1 and 1.2.3 are not valid.',
  },
  {
    name: 'Date (YYYY-MM-DD)',
    pattern: String.raw`\b(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\d|3[01])\b`,
    flags: 'g',
    sample: 'Released 2026-10-26, patched 2026-11-03.\n2026-13-01 has no 13th month.',
  },
  {
    name: 'Time (24-hour)',
    pattern: String.raw`\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b`,
    flags: 'g',
    sample: 'Standup 09:30, deploy 17:45:10.\nNot times: 24:00 or 7:5.',
  },
  {
    name: 'Phone number (US)',
    pattern: String.raw`\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b`,
    flags: 'g',
    sample: 'Call (555) 123-4567, 555.987.6543 or 5550001111.',
  },
  {
    name: 'ZIP code (US)',
    pattern: String.raw`\b\d{5}(?:-\d{4})?\b`,
    flags: 'g',
    sample: 'Ship to 94103 or 10001-1234, not 1234.',
  },
  {
    name: 'Hex color',
    pattern: String.raw`#(?:[0-9a-fA-F]{3}){1,2}\b`,
    flags: 'g',
    sample: 'Sun is #FFD25E, ink #131211, short #fff.\nNot colors: #12345 or #ggg.',
  },
  {
    name: 'UUID',
    pattern: String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`,
    flags: 'gi',
    sample: 'id 3f2b8c1e-9a4d-4e7b-8c2f-1d0e5a6b7c8d\nand 018F4B2E-7C3A-7B21-9D4E-5F6A7B8C9D0E',
  },
  {
    name: 'Number with commas',
    pattern: String.raw`\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b`,
    flags: 'g',
    sample: 'Totals: 1,234,567.89 and 42 and 3.14',
  },
  {
    name: 'Strong password',
    pattern: String.raw`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{12,}$`,
    flags: 'gm',
    sample: 'correct horse\nCorrectHorse42!\nSh0rt!',
  },
  {
    name: 'Repeated word',
    pattern: String.raw`\b(\w+)\s+\1\b`,
    flags: 'gi',
    sample: 'This is is a test of the The tool.',
  },
  {
    name: 'HTML tag pair',
    pattern: String.raw`<(?<tag>[a-z][a-z0-9-]*)\b[^>]*>(?<content>.*?)<\/\k<tag>>`,
    flags: 'gi',
    sample: '<p class="lead">Hello</p> <b>bold</b> <i>never closed',
  },
];

/** [token, what it means]; tokens are inserted into the pattern on click */
export const CHEAT_SHEET: { title: string; items: [string, string][] }[] = [
  {
    title: 'Characters',
    items: [
      ['.', 'any character except line breaks'],
      ['\\d', 'digit 0–9'],
      ['\\w', 'letter, digit or _'],
      ['\\s', 'whitespace'],
      ['\\D', 'not a digit (likewise \\W, \\S)'],
      ['\\n', 'newline (\\t is a tab)'],
      ['\\.', 'a literal dot (escape any special char)'],
    ],
  },
  {
    title: 'Sets',
    items: [
      ['[abc]', 'a, b or c'],
      ['[^abc]', 'anything but a, b or c'],
      ['[a-z]', 'a range'],
      ['\\p{L}', 'any letter in any language (u or v)'],
      ['[\\p{L}--[a-z]]', 'set difference (v)'],
    ],
  },
  {
    title: 'Anchors',
    items: [
      ['^', 'start of text (or line, with m)'],
      ['$', 'end of text (or line, with m)'],
      ['\\b', 'word boundary'],
      ['\\B', 'not a word boundary'],
    ],
  },
  {
    title: 'Quantifiers',
    items: [
      ['*', '0 or more'],
      ['+', '1 or more'],
      ['?', '0 or 1'],
      ['{3}', 'exactly 3'],
      ['{2,5}', '2 to 5'],
      ['{2,}', '2 or more'],
      ['+?', 'as few as possible (lazy)'],
    ],
  },
  {
    title: 'Groups',
    items: [
      ['(…)', 'capture group'],
      ['(?:…)', 'group without capturing'],
      ['(?<name>…)', 'named group'],
      ['\\1', 'same text as group 1'],
      ['\\k<name>', 'same text as a named group'],
      ['|', 'or, as in cat|dog'],
    ],
  },
  {
    title: 'Lookaround',
    items: [
      ['(?=…)', 'followed by'],
      ['(?!…)', 'not followed by'],
      ['(?<=…)', 'preceded by'],
      ['(?<!…)', 'not preceded by'],
    ],
  },
  {
    title: 'Replacement',
    items: [
      ['$1', 'group 1'],
      ['$<name>', 'a named group'],
      ['$&', 'the whole match'],
      ['$`', 'text before the match'],
      ["$'", 'text after the match'],
      ['$$', 'a literal $'],
    ],
  },
];

import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'regex-tester',
  category: 'dev',
  name: 'Regex tester',
  title: 'Regex Tester: test JavaScript regular expressions live',
  h1: 'Regex *tester*',
  description: 'Test JavaScript regular expressions with live match highlighting, capture groups, replace preview, plain-English errors, a cheat sheet and ready-made patterns.',
  tagline: 'Live highlighting, groups, replace preview and errors that tell you what to fix.',
  keywords: ['regex tester', 'regular expression tester', 'regex online', 'javascript regex', 'test regex', 'regex replace', 'regex cheat sheet', 'regex match highlighter', 'regex validator'],
  island: 'RegexTester',
  steps: [
    'Type a pattern and switch flags like g, i and m on or off, or load a common pattern.',
    'Paste your text. Matches light up as you type, with every capture group and its position listed.',
    'Switch to replace to preview a substitution using $1 or $<name>, then copy the result or the regex as code.',
  ],
  faq: [
    {
      q: 'Which regex flavor does it use?',
      a: 'JavaScript\'s, run by your browser\'s own engine, so results match what your JS or TypeScript code will do. That includes named groups, lookbehind, Unicode property escapes with the u flag and set operations with the v flag. Other flavors such as PCRE or Python differ in places.',
    },
    {
      q: 'What happens if my pattern is very slow?',
      a: 'Matching runs in a background worker. If it takes more than 2 seconds, usually because of catastrophic backtracking from nested quantifiers like (a+)+, it is stopped and you get an explanation, so the page never freezes.',
    },
    {
      q: 'How do I use capture groups in a replacement?',
      a: 'Use $1, $2 and so on for numbered groups, $<name> for named groups, $& for the whole match, and $$ for a literal dollar sign. Without the g flag only the first match is replaced.',
    },
    {
      q: 'Why does my pattern match nothing?',
      a: 'Common causes are case (turn on i), ^ and $ only matching the start and end of the whole text (turn on m to match each line), and . not matching line breaks (turn on s). Special characters like . ? + ( need a backslash to match literally.',
    },
    privacyFaq,
  ],
  related: ['json-formatter', 'diff-checker', 'jwt-decoder', 'remove-duplicate-lines'],
} satisfies Tool;

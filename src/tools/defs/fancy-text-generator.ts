import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'fancy-text-generator',
  category: 'text',
  name: 'Fancy text & font generator',
  title: 'Fancy Text Generator: copy and paste fonts for bios & posts',
  h1: 'Fancy *text* generator',
  description: 'Turn plain text into 30+ copy-and-paste styles: bold, italic, cursive, gothic, bubble, small caps, upside down, glitch and more. One click to copy.',
  tagline: 'Type once, get 30+ Unicode styles, copy any of them in one click.',
  keywords: ['fancy text', 'font generator', 'copy and paste fonts', 'instagram fonts', 'cursive text', 'bold text generator', 'zalgo text', 'upside down text', 'small caps generator'],
  island: 'FancyText',
  steps: [
    'Type or paste your text into the box.',
    'Browse the styles, or filter to bold, script, shapes, effects or decor.',
    'Click any style to copy it, then paste it into your bio, post or message.',
  ],
  faq: [
    { q: 'How does this work without changing fonts?', a: 'Each style swaps your letters for look-alike Unicode characters, such as the mathematical bold or script letters. Because they are characters rather than formatting, they paste into Instagram, TikTok, X, Discord and most other apps.' },
    { q: 'Why do some letters look off or show as boxes?', a: 'A few styles have gaps in Unicode, so we borrow the closest symbol (superscript has no proper "q", for example). Older phones and some apps also lack fonts for the newer symbols and show empty boxes instead.' },
    { q: 'Is fancy text accessible?', a: 'Not very. Screen readers often read these characters letter by letter, as math symbols, or not at all, and search engines may not match them to normal words. Use them sparingly, for a word or two in a bio rather than your whole name or important info.' },
    { q: 'Why does the glitch text change when I click Reshuffle?', a: 'Glitch text stacks random accent marks on each letter. Reshuffle picks a new random pattern, and the intensity slider controls how tall the stacks get.' },
    privacyFaq,
  ],
  related: ['case-converter', 'word-counter', 'lorem-ipsum-generator'],
} satisfies Tool;

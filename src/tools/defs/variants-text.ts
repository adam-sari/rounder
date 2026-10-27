import { privacyFaq, type Tool } from '../types';

export default [
  {
    slug: 'character-counter',
    category: 'text',
    name: 'Character counter',
    title: 'Character Counter: X, SMS, Instagram & meta description limits',
    h1: 'Character *counter*',
    description: 'Count characters with and without spaces as you type, and see how much room is left in an X post, a text message, an Instagram caption or a YouTube title.',
    tagline: 'Characters as you type, with live meters for X, texts, Instagram, YouTube and search snippets.',
    keywords: ['character count', 'letter counter', 'count characters', 'characters with spaces', 'tweet character counter', 'sms character counter', 'meta description length', 'instagram caption length', 'youtube title length'],
    island: 'WordCounter',
    props: { focus: 'chars', limits: ['x', 'sms', 'instagram', 'youtube', 'meta'] },
    variantOf: 'word-counter',
    steps: [
      'Type or paste your text into the box.',
      'Read the character count with and without spaces, and the meter for each platform: it shows how many characters are left, or how far over you are.',
      'Trim until the meters you care about are in range, then copy your text back out.',
    ],
    faq: [
      { q: 'How are characters counted?', a: 'Each character you see counts as one, so an emoji, a flag or an accented letter is one character, even when it takes several code units inside the computer. Spaces and line breaks count too; "no spaces" leaves out all whitespace.' },
      { q: 'Why does the X meter show a different number?', a: 'X counts its own way: every link counts as 23 characters however long it is, because X shortens it, and every emoji and every Chinese, Japanese or Korean character counts as 2. The X meter follows those rules. It spots links that start with http or www and bare addresses on common endings like .com; X recognizes a few more. Paid X accounts can post longer texts, so 280 is the limit for standard accounts.' },
      { q: 'Why did my text message drop to 70 characters?', a: 'A text uses the GSM-7 alphabet when it can, which fits 160 characters in one message. A single character outside it, such as an emoji, a curly quote or many accented letters, switches the whole message to UCS-2, which fits only 70. Longer texts are split into parts of 153 (GSM-7) or 67 (UCS-2) characters that phones join back together. The SMS meter names the character that caused the switch, and a few symbols like € [ ] { } count as 2 in GSM-7.' },
      { q: 'How long should a meta description be?', a: 'Google says there is no limit on how long a meta description can be, and it cuts snippets to fit the screen. Keeping to about 155 to 160 characters is a common rule of thumb for showing in full on a computer, so the meter uses 160 as a guide, not a rule. Google may also write its own snippet from your page instead.' },
      privacyFaq,
    ],
    related: ['word-counter', 'case-converter', 'remove-duplicate-lines', 'fancy-text-generator'],
    notes: {
      limits: [
        { where: 'X post', limit: '280 characters for standard accounts. Links count as 23, emoji and CJK characters as 2.', source: 'https://docs.x.com/resources/fundamentals/counting-characters' },
        { where: 'SMS text', limit: '160 GSM-7 characters or 70 UCS-2 characters in one text; 153 or 67 per part once split.', source: 'https://www.twilio.com/docs/glossary/what-sms-character-limit' },
        { where: 'Instagram caption', limit: '2,200 characters, with at most 30 hashtags and 20 @ tags.', source: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media' },
        { where: 'YouTube video', limit: '100 characters in the title, 5,000 in the description.', source: 'https://support.google.com/youtube/answer/57404' },
        { where: 'Google meta description', limit: 'No length limit; Google cuts the snippet to fit the screen.', source: 'https://developers.google.com/search/docs/appearance/snippet' },
      ],
    },
  },
] satisfies Tool[];

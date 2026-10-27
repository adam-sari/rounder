import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'lorem-ipsum-generator',
  category: 'text',
  name: 'Lorem ipsum generator',
  title: 'Lorem Ipsum Generator: paragraphs, words, lists & HTML',
  h1: 'Lorem ipsum *generator*',
  description: 'Generate lorem ipsum or readable English placeholder text by paragraphs, sentences, words or list items. Copy as plain text, HTML or Markdown.',
  tagline: 'Placeholder text by the paragraph, sentence, word or list item.',
  keywords: ['lorem ipsum', 'dummy text', 'placeholder text', 'filler text', 'lipsum', 'lorem ipsum html', 'random text generator', 'english placeholder text'],
  island: 'LoremIpsum',
  steps: [
    'Choose paragraphs, sentences, words or list items, and how many.',
    'Pick classic Latin or readable English, and plain text, HTML or Markdown.',
    'Copy or download the text. Click "New text" for a fresh batch.',
  ],
  faq: [
    { q: 'What does lorem ipsum mean?', a: 'It is scrambled Latin based on a passage from Cicero\'s "De finibus bonorum et malorum". It looks like real text but reads as nonsense, so people judge the layout rather than the words.' },
    { q: 'When should I use the readable English option?', a: 'When you test with people who might be distracted by Latin, or you want to see how real sentences wrap. It is plain, obviously placeholder copy, so nobody mistakes it for the final text.' },
    { q: 'What is the seed for?', a: 'The same seed and settings always produce the same text, so you can recreate a mockup exactly or share settings with a teammate. "New text" just picks a new seed.' },
    privacyFaq,
  ],
  related: ['word-counter', 'markdown-editor', 'fancy-text-generator'],
} satisfies Tool;

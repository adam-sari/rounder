import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'image-to-text',
  category: 'ai',
  name: 'Image to text (OCR)',
  title: 'Image to Text: free OCR for photos & screenshots, private',
  h1: 'Image to *text*',
  description: 'Free OCR: copy text from images, screenshots and scans in 24 languages. Paste or drop a batch, see each word highlighted. Runs on your device, no upload.',
  tagline: 'Copy the text out of screenshots, photos and scans, right in your browser.',
  keywords: ['image to text', 'ocr online', 'extract text from image', 'screenshot to text', 'photo to text', 'jpg to text', 'copy text from image', 'picture to text converter', 'text recognition', 'tesseract'],
  island: 'ImageToText',
  steps: [
    'Pick the language of the text, then press "Download & start" once (a few MB for the language).',
    'Drop in images or paste a screenshot with ⌘V / Ctrl+V. Add as many as you like.',
    'Check the highlighted words (yellow means unsure), edit the text if needed, then copy it or download a .txt.',
  ],
  faq: [
    {
      q: 'Which OCR model is used, and what is its license?',
      a: 'Tesseract, the open-source OCR engine started at HP and developed by Google and its community, with its "fast" neural-network language models (tessdata_fast). Both are under the Apache-2.0 license. It runs in your browser with WebAssembly on your processor: each language is a one-time download of 0.5–6 MB, plus about 4 MB for the engine, and is then reused from your browser.',
    },
    {
      q: 'How accurate is it?',
      a: "Very good on clear printed text: screenshots, documents and scans. Accuracy drops on handwriting, stylized fonts, text on busy backgrounds, curved pages and blurry or tilted photos. It's AI, so it can make mistakes: words it is unsure of are highlighted in yellow, and you can fix the text before copying it.",
    },
    {
      q: 'Can it read several languages at once?',
      a: 'Yes. Pick up to three languages, for example English and German for a bilingual letter. Pick only the languages that are really in the image: each extra one makes reading a little slower and can add odd guesses.',
    },
    {
      q: 'Does it keep line breaks and paragraphs?',
      a: 'Yes. The text comes out line by line with a blank line between paragraphs, as laid out in the image. Press "Join lines" to turn each paragraph into one line (mending words split with a hyphen) before pasting it into a document or email.',
    },
    filePrivacyFaq,
  ],
  related: ['ocr-pdf', 'pdf-to-text', 'translator', 'alt-text-generator'],
  flagship: { elsewhere: 'Daily limits, uploads and paid batch OCR', here: 'Unlimited images, free, never uploaded' },
} satisfies Tool;

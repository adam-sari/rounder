import { MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'ocr-pdf',
  category: 'pdf',
  name: 'Scanned PDF to searchable PDF (OCR)',
  title: 'OCR PDF: make a scanned PDF searchable, free & private',
  h1: 'OCR *PDF*',
  description: 'Turn scanned PDFs into searchable, selectable PDFs that look exactly the same. 24 languages, text export, no page limit. Runs on your device, nothing uploaded.',
  tagline: 'Add an invisible text layer to scanned pages so you can search, select and copy.',
  keywords: ['ocr pdf', 'make pdf searchable', 'scanned pdf to searchable pdf', 'searchable pdf', 'pdf ocr online free', 'scanned pdf to text', 'ocr scanned document', 'copy text from scanned pdf', 'pdf text recognition'],
  island: 'OcrPdf',
  steps: [
    'Pick the document\'s language and press "Download & start" once, then drop in a scanned PDF.',
    'Pages that already have text are left alone; the rest are read one by one, with progress per page.',
    'Download the searchable PDF, which looks exactly like the original, or just its text as a .txt file.',
  ],
  faq: [
    {
      q: 'Will my PDF look different?',
      a: 'No. The original pages are kept as they are, scan quality included. The recognized text is laid invisibly on top of each page, word by word in the right place, so you can search it, select it and copy it, and screen readers can read it. The file grows a little (usually a few KB per page).',
    },
    {
      q: 'Which OCR model is used, and what is its license?',
      a: 'Tesseract, the open-source OCR engine developed by Google and its community, with its "fast" neural-network language models (tessdata_fast), both under the Apache-2.0 license. It writes the invisible text layer itself, in a way that works for every script, including Chinese, Arabic and Hindi. Each language is a one-time download of 0.5–6 MB plus about 4 MB for the engine.',
    },
    {
      q: 'How long does it take?',
      a: 'Usually 3–8 seconds per page on a laptop, longer on phones and for dense pages. Each page is rendered at 300 dpi and read on your processor; on computers with many cores two pages are read at once. You can stop at any time and still download the pages read so far.',
    },
    {
      q: 'How accurate is the text?',
      a: "Very good on clean, straight scans of printed text. Low-resolution scans, faint copies, handwriting and photos taken at an angle give more mistakes. It's AI, so check anything important; the text you can copy is exactly what was recognized. Picking the right language matters most.",
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Languages', effect: 'Tesseract reads the scripts you pick; each language is a one-time download from jsDelivr (English is 3.9 MB) and is cached afterwards. Picking several helps mixed documents but slows reading a little.' },
      { name: 'Pages that already have text', effect: 'Skipped and kept as they are. "Read those pages too" is only for pages whose text comes out garbled; they get a second text layer.' },
      { name: 'How a page is read', effect: 'Each page is rendered at about 300 dpi in grayscale for Tesseract, two pages at a time on desktops with 6 or more cores.' },
    ],
    results: [
      { input: '10-page letter-size color scan of typed text at 300 dpi, 15 MB, 9,717 words', setting: 'English', output: 'searchable PDF, 129 KB larger', note: '9,715 words read correctly; 54 s for the 10 pages' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'Searchable PDF', about: 'The scan stays byte for byte as it was. An invisible text layer is stamped on each page, word by word, the way OCRmyPDF does it, so you can search, select and copy.' },
      { name: 'Text (.txt)', about: 'Just the words, page by page, for pasting elsewhere.' },
    ],
  },
  related: ['image-to-text', 'pdf-to-text', 'compress-pdf'],
  next: ['pdf-to-text', 'compress-pdf'],
  flagship: { elsewhere: 'Adobe Acrobat Pro subscription, or page limits online', here: 'Free, any number of pages, never uploaded' },
} satisfies Tool;

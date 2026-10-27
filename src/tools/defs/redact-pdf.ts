import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'redact-pdf',
  category: 'pdf',
  name: 'Redact PDF',
  title: 'Redact PDF: permanently black out text, free and private',
  h1: 'Redact *PDF*',
  description: 'Black out names, emails, phone and card numbers in a PDF for good. Search or draw boxes, and the text underneath is really removed. Free, nothing uploaded.',
  tagline: 'Find or box what has to go. It comes out of the file, not just under a black bar.',
  keywords: ['redact pdf', 'black out text in pdf', 'pdf redaction tool', 'remove sensitive information from pdf', 'censor pdf', 'hide text in pdf', 'redact pdf free', 'remove metadata from pdf'],
  island: 'RedactPdf',
  steps: [
    'Open your PDF. It is read on your device and never uploaded.',
    'Search for words or turn on a preset for emails, phone numbers, card numbers or SSNs, and drag boxes over anything else. Check every mark in the list.',
    'Click Redact & download. Marked pages are rebuilt without the hidden content, and the saved file is read back to confirm the text is gone.',
  ],
  faq: [
    {
      q: 'Is the redaction permanent, or just a black box on top?',
      a: 'Permanent. Every page with a mark is redrawn as an image with the boxes painted into its pixels, and the original page content (text, fonts, images, comments) is deleted from the file. After saving, the tool opens the new file and searches it to confirm the marked text can no longer be found.',
    },
    {
      q: 'Why can’t I select text on the redacted pages?',
      a: 'Those pages are images now, which is what makes the redaction safe. There is no text recognition (OCR) here, so their remaining words can’t be selected or searched. Pages you didn’t mark keep their text and quality. Their links, comments and form fields stay too, unless you leave “Remove hidden extras” on.',
    },
    {
      q: 'What do the presets find?',
      a: 'Email addresses, phone numbers in common formats (7 to 15 digits), card numbers that pass the standard Luhn checksum, and US Social Security numbers written like 123-45-6789 or 123 45 6789. Patterns can miss unusual formats, so review the matches and box anything they skip.',
    },
    {
      q: 'Can I redact a scanned PDF?',
      a: 'Yes, by drawing boxes. A scan is a picture of text, so search can’t see its words, but anything you box is painted over and the original scan of that page is removed.',
    },
    filePrivacyFaq,
  ],
  related: ['protect-pdf', 'edit-pdf', 'exif-remover'],
  next: ['protect-pdf', 'compress-pdf'],
  noAds: true,
  flagship: { elsewhere: 'A paid Acrobat Pro feature', here: 'True redaction, free' },
} satisfies Tool;

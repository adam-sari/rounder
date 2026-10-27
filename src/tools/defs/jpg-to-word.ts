import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'jpg-to-word',
  category: 'ai',
  name: 'JPG to Word',
  title: 'JPG to Word: photo or scan to editable DOCX with OCR, free',
  h1: 'JPG to *Word*',
  description: 'Turn photos and scans of text (JPG, PNG, WebP) into an editable Word document. Text is recognized with OCR on your device, in 24 languages. Free and private.',
  tagline: 'Photos of pages become editable paragraphs and tables in a .docx.',
  keywords: ['jpg to word', 'image to word', 'photo to word', 'png to word', 'picture to word', 'convert image to word', 'jpg to docx', 'scan to word', 'image to word converter'],
  island: 'PdfToOffice',
  props: { to: 'word', from: 'images' },
  steps: [
    'Drop in one or more photos or scans of text. Each picture becomes a page, in the order you dropped them.',
    'Pick the language and start OCR (a one-time download of about 4 MB plus the language). The text is recognized on your device.',
    'Download the .docx: paragraphs, headings and tables you can edit in Word, Google Docs or Pages.',
  ],
  faq: [
    {
      q: 'How accurate is the text?',
      a: 'Very good on sharp, straight photos and scans of printed text. Blurry or angled photos, small print, handwriting and busy backgrounds give more mistakes, so give the result a quick read. Picking the right language matters most.',
    },
    {
      q: 'Is the layout kept?',
      a: 'The structure is: paragraphs, larger text as headings, and text that lines up in columns as tables. Fonts aren’t recognized, so the text uses one plain font at roughly the size it had in the picture. Logos, photos and drawings inside the picture are not cut out.',
    },
    {
      q: 'What if I skip OCR?',
      a: 'Then each picture is placed in the document as a picture, one per page, which is handy for putting photos into a Word file but not for editing the text.',
    },
    filePrivacyFaq,
  ],
  related: ['image-to-text', 'pdf-to-word', 'ocr-pdf', 'jpg-to-pdf'],
  next: ['word-to-pdf'],
} satisfies Tool;

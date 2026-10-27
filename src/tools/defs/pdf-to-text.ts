import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'pdf-to-text',
  category: 'pdf',
  name: 'PDF to text',
  title: 'PDF to Text: extract text from a PDF in reading order, free',
  h1: 'PDF to *text*',
  description: 'Extract text from any PDF in reading order, columns and paragraphs intact. Copy it or save as .txt or .md. Free, no sign-up, nothing uploaded.',
  tagline: 'Pull the text out of a PDF in reading order, with line breaks and paragraphs kept.',
  keywords: ['pdf to text', 'extract text from pdf', 'pdf to txt', 'copy text from pdf', 'pdf text extractor', 'convert pdf to text', 'pdf to markdown', 'pdf to plain text'],
  island: 'PdfToText',
  steps: [
    'Drop in a PDF. Password-protected files are fine: you can unlock them right here.',
    'The text is read page by page, keeping columns, line breaks and paragraphs in reading order.',
    'Copy it, browse page by page, or download it as a .txt or Markdown file.',
  ],
  faq: [
    { q: 'Does it keep the layout?', a: 'It keeps what matters for reading: line breaks, paragraphs and the order of columns, so two-column articles come out one column after the other. Table cells are separated by tabs, which paste neatly into a spreadsheet. Fonts, colors and images are left out, since plain text can\'t hold them.' },
    { q: 'Why is some of my PDF missing?', a: 'Pages that are scanned images have no text to extract, only a picture of it. The tool tells you which pages look scanned. To read those, run the PDF through OCR PDF first: it recognizes the text on your device and makes the pages searchable.' },
    { q: 'What does "Join wrapped lines" do?', a: 'PDFs break lines wherever the page edge is. This option puts each paragraph back on one line and mends words split with a hyphen, which is handy when pasting into an email or document.' },
    { q: 'Is there a page or size limit?', a: 'No. Long documents are read page by page with a progress bar, and you can stop at any time and keep what has been read so far.' },
    filePrivacyFaq,
  ],
  related: ['ocr-pdf', 'pdf-to-jpg', 'extract-images-from-pdf', 'word-counter'],
} satisfies Tool;

import { MEASURED } from '../lib/notes';
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
  notes: {
    settings: [
      { name: 'Page markers (on)', effect: 'Puts a "Page 3" line between pages (a "## Page 3" heading in Markdown), so quotes can be traced back.' },
      { name: 'Join wrapped lines', effect: 'One line per paragraph instead of the PDF\'s line breaks, and words hyphenated at a line end are mended ("exam-" + "ple" becomes "example") while real hyphens stay.' },
      { name: 'Reading order', effect: 'Text is grouped into lines and paragraphs, and two-column layouts are read column by column by splitting at the gutter between them.' },
      { name: '.txt or .md', effect: 'Plain text, or Markdown where table-like rows (cells separated by wide gaps) become Markdown tables.' },
    ],
    results: [
      { input: '20-page report with photos and charts, 2.3 MB', setting: 'Defaults', output: '10,590 words, 72 KB of text', note: '0.3 s' },
      { input: '50-page text-only PDF, 21 KB', setting: 'Defaults', output: '950 words', note: '0.2 s' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'PDFs with a text layer', about: 'Made from Word, Google Docs, a browser or most office software. The text is read exactly as stored, so nothing is guessed.' },
      { name: 'Scans', about: 'Only pictures of pages, with no text inside. Those pages come out empty; OCR PDF reads them instead.' },
    ],
  },
  related: ['ocr-pdf', 'pdf-to-jpg', 'extract-images-from-pdf', 'word-counter'],
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'pdf-to-word',
  category: 'pdf',
  name: 'PDF to Word',
  title: 'PDF to Word Converter: editable DOCX, free & no upload',
  h1: 'PDF to *Word*',
  description: 'Convert PDF to an editable Word document (.docx) with real paragraphs, headings, lists, tables and pictures. Scans are read with OCR. Free, nothing uploaded.',
  tagline: 'Turn a PDF into a .docx you can edit: paragraphs, headings, lists, tables and pictures.',
  keywords: ['pdf to word', 'pdf to docx', 'convert pdf to word', 'pdf to word editable', 'pdf to doc', 'scanned pdf to word', 'pdf to word converter free', 'pdf to word without upload'],
  island: 'PdfToOffice',
  props: { to: 'word' },
  steps: [
    'Drop in a PDF. Password-protected files ask for their password first.',
    'Each page is read in reading order: paragraphs, headings, bullet and numbered lists, tables, pictures and links are rebuilt as Word ones. Scanned pages can be read with OCR.',
    'Download the .docx and open it in Word, Google Docs, LibreOffice or Pages.',
  ],
  faq: [
    {
      q: 'How close is the Word file to my PDF?',
      a: 'The text comes across as real, editable paragraphs, with fonts, sizes, bold, italics, colors and alignment, plus Word headings (so the navigation pane works), bullet and numbered lists, tables, pictures and links. It is rebuilt as a flowing document rather than copied box by box, so layouts with several columns become one column in reading order, and line breaks fall where Word puts them. Charts and drawings made of lines and shapes rather than pictures are left out.',
    },
    {
      q: 'What about scanned PDFs?',
      a: 'A scanned page is a picture of text, so there is nothing to copy. The tool tells you which pages are scans. Click "Recognize the text (OCR)" to read them on your device with Tesseract (a one-time download of about 4 MB plus your language); the recognized text then becomes paragraphs and tables like any other page. Without OCR, each scanned page goes into the document as a picture.',
    },
    {
      q: 'Are tables kept as tables?',
      a: 'Yes, when the text lines up in columns: each table becomes a Word table with its rows, columns and a bold header row. Cells that wrap onto a second line are joined back up. Very irregular layouts, such as forms with boxes scattered over the page, may come through as plain paragraphs instead.',
    },
    {
      q: 'Is there a page limit?',
      a: 'No. Pages are read one at a time on your device, so long documents work too; they just take longer. A 40-page text report took under a second in our tests on a desktop computer; phones are slower, and OCR takes a few seconds per scanned page.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Keep page breaks', effect: 'Starts each PDF page on a new Word page. Turn it off for one continuous document.' },
      { name: 'Recognize the text (OCR)', effect: 'Shown when pages are scans. Reads them with Tesseract on your device; without it they go in as pictures.' },
    ],
    results: [
      { input: '2-page report (16 KB): headings, lists, a table, a chart, two columns', setting: 'Default', output: '.docx with Word headings, lists, a table and the chart, 24 KB, in 0.4 s' },
      { input: '40-page text report (51 KB)', setting: 'Default', output: '.docx with 40 headings and 40 tables, 15 KB, in 0.4 s' },
      { input: '1-page scan (33 KB)', setting: 'OCR, English', output: '.docx with editable paragraphs, in 5 s including the first-time language download' },
    ],
    measured: { date: '2026-10-27', device: 'Chromium 156 on a Windows 11 desktop (Intel Core i7-12700F)' },
  },
  related: ['word-to-pdf', 'pdf-to-text', 'ocr-pdf', 'pdf-to-excel', 'jpg-to-word'],
  next: ['word-to-pdf'],
  flagship: { elsewhere: 'Uploads your PDF, and OCR is often a paid extra', here: 'Converted on your device, OCR included' },
} satisfies Tool;

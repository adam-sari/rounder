import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'word-to-pdf',
  category: 'pdf',
  name: 'Word to PDF',
  title: 'Word to PDF Converter: DOCX to PDF on your device, free',
  h1: 'Word to *PDF*',
  description: 'Convert Word documents (.docx) to PDF with selectable text, tables, pictures, headers and footers. Free, no sign-up, and your file is never uploaded.',
  tagline: 'Turn a .docx into a PDF in your browser, with real text and Word’s page layout.',
  keywords: ['word to pdf', 'docx to pdf', 'convert word to pdf', 'doc to pdf', 'word document to pdf', 'save word as pdf', 'docx to pdf converter', 'word to pdf offline'],
  island: 'OfficeToPdf',
  props: { from: 'word' },
  steps: [
    'Drop in a Word document (.docx). The first time, the Word reader loads once, about 1.1 MB.',
    'Your browser lays the pages out with Word’s page size, margins and page breaks, and writes them into a PDF with real, selectable text.',
    'Check the page previews, then download the PDF.',
  ],
  faq: [
    {
      q: 'Will the PDF look the same as in Word?',
      a: 'Close, for most documents. Page size, margins, headings, bold, italics, colors, lists, tables, pictures, headers and footers come across, and pages break where Word broke them when the file was last saved in Word. Line breaks can shift a little, because fonts are matched rather than copied. Text boxes, shapes, SmartArt, charts and equations may be missing or placed differently, so check the preview before you send it.',
    },
    {
      q: 'Which fonts does it use?',
      a: 'Free fonts with the same letter widths as Word’s usual ones: Carlito for Calibri, Caladea for Cambria, Arimo for Arial, Tinos for Times New Roman and Cousine for Courier New. Other fonts fall back to the closest of these, so a document set in a decorative font will look plainer. The fonts are embedded, so the PDF looks the same everywhere.',
    },
    {
      q: 'Can I convert an old .doc file?',
      a: 'Not yet. Only the .docx format Word has used since 2007 can be read here. Open the .doc in Word, Google Docs or LibreOffice, save it as .docx, and drop that in. The same goes for password-protected documents: remove the password first.',
    },
    {
      q: 'Is the text in the PDF selectable and searchable?',
      a: 'Yes. Every word is real text in the PDF, so you can search, select and copy it, and links stay clickable. Characters the embedded fonts don’t have, such as Chinese, Arabic or emoji, are drawn as small pictures instead, and the tool tells you when that happens.',
    },
    filePrivacyFaq,
  ],
  notes: {
    results: [
      { input: '4-page proposal (.docx, 18 KB): table, chart picture, lists, header and footer', setting: 'Default', output: '4-page PDF, 69 KB, in 0.4 s' },
      { input: '40-chapter text document (.docx, 11 KB)', setting: 'Default', output: '40-page PDF, 677 KB, in 1.7 s' },
    ],
    measured: { date: '2026-10-27', device: 'Chromium 156 on a Windows 11 desktop (Intel Core i7-12700F)' },
    formats: [
      { name: 'DOCX', about: 'The format Word has saved in since 2007, and what Google Docs, Pages and LibreOffice export as “Word”. This is what the tool reads.' },
      { name: 'DOC', about: 'The older binary Word format. It can’t be read here; open it in a word processor and save it as .docx first.' },
    ],
  },
  related: ['pdf-to-word', 'excel-to-pdf', 'powerpoint-to-pdf', 'merge-pdf', 'compress-pdf'],
  next: ['compress-pdf', 'merge-pdf'],
  flagship: { elsewhere: 'Your document is uploaded to someone’s server', here: 'Converted on your device, never uploaded' },
} satisfies Tool;

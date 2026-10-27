import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'compare-pdf',
  category: 'pdf',
  name: 'Compare PDF',
  title: 'Compare PDF Files: find text and visual differences, free',
  h1: 'Compare *PDF* files',
  description: 'Compare two PDFs and see every added or removed word, plus a visual check that highlights changed images and layout. Free, and nothing is uploaded.',
  tagline: 'Drop in two versions and see exactly what changed, word by word and pixel by pixel.',
  keywords: ['compare pdf', 'pdf diff', 'compare two pdf files', 'pdf compare online', 'difference between two pdfs', 'compare pdf documents', 'pdf comparison tool', 'compare pdf text'],
  island: 'ComparePdf',
  steps: [
    'Add the original PDF on the left and the changed version on the right. Locked PDFs ask for their password.',
    'Read the text changes side by side or inline, and jump between them with the arrows (or N and P).',
    'Switch to visual changes to spot edits in images, colors and layout, then download a report as .txt or .html.',
  ],
  faq: [
    {
      q: 'What if the PDFs have a different number of pages?',
      a: 'Pages are matched by their content, so an inserted or deleted page shows up as new or removed instead of making every later page look different. You can switch to matching by page number if you prefer.',
    },
    {
      q: 'Can it compare scanned PDFs?',
      a: 'Scans have no selectable text, so the text comparison has nothing to read. The visual comparison still works: it draws both pages and highlights the pixels that differ, in red for the original and blue for the changed version.',
    },
    {
      q: 'Why does a page show a visual change but no text change?',
      a: 'The words are the same but something else moved or changed, such as an image, a color, a font or the spacing. The difference view shows where.',
    },
    {
      q: 'Is there a page or size limit?',
      a: 'No limits from us. Everything runs on your device, so very long documents just take a little longer to read and scan.',
    },
    filePrivacyFaq,
  ],
  related: ['diff-checker', 'pdf-to-text', 'merge-pdf', 'organize-pdf'],
  flagship: { elsewhere: 'A paid feature in Acrobat Pro', here: 'Free, and your files never leave your device' },
} satisfies Tool;

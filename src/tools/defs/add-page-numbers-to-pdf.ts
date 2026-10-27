import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'add-page-numbers-to-pdf',
  category: 'pdf',
  name: 'Add page numbers to PDF',
  title: 'Add Page Numbers to PDF: free, no upload, any position',
  h1: 'Add page *numbers* to PDF',
  description: 'Number PDF pages in your browser. Pick the position, format, font and starting number, skip the cover and preview it live. Batches welcome, nothing uploaded.',
  tagline: 'Page 1 of N, in the corner you want, previewed before you save.',
  keywords: ['add page numbers to pdf', 'number pdf pages', 'pdf page numbering', 'insert page numbers pdf', 'paginate pdf', 'add page numbers to pdf online', 'page x of y pdf', 'pdf footer page number'],
  island: 'PdfPageNumbers',
  steps: [
    'Drop in one or more PDFs. If a file is password-protected, you will be asked for its password.',
    'Choose where the numbers go and how they read, like "Page 1 of 12". The preview updates as you change things.',
    'Click Add page numbers, then download each PDF or all of them as a zip.',
  ],
  faq: [
    {
      q: 'Can I leave the cover page unnumbered?',
      a: 'Yes. Turn on "Skip the first page" and numbering starts on page 2. It gets the "start at" number, so set that to 2 if the cover should still count. Use "Choose pages" to number only part of the document, like 3-12.',
    },
    {
      q: 'What does {total} mean in a custom format?',
      a: 'It is the last number printed, so "Page {n} of {total}" ends with "Page 12 of 12" on the last numbered page. {n} is the number of the current page.',
    },
    {
      q: 'Do the numbers work on rotated or cropped pages?',
      a: 'Yes. Numbers are placed on the page as you see it, so they land in the right corner and read upright on landscape, rotated and cropped pages too.',
    },
    {
      q: 'Which fonts and languages are supported?',
      a: 'Sans, serif and mono versions of the standard PDF fonts. Characters those fonts lack, such as Greek, Cyrillic or letters like ł and ő, use an embedded Noto Sans font instead. Chinese, Japanese, Korean, Arabic and emoji characters aren\'t supported yet.',
    },
    filePrivacyFaq,
  ],
  related: ['watermark-pdf', 'merge-pdf', 'organize-pdf', 'split-pdf'],
  flagship: { elsewhere: 'Daily task limits and file size caps', here: 'Unlimited PDFs, no size cap' },
} satisfies Tool;

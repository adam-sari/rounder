import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'merge-pdf',
  category: 'pdf',
  name: 'Merge PDF',
  title: 'Merge PDF: combine PDF files and images in any order, free',
  h1: 'Merge *PDF* files',
  description: 'Combine PDFs and images into one PDF. Reorder files or single pages, rotate or remove pages, add bookmarks. No file limits, no sign-up, no uploads.',
  tagline: 'Combine PDFs and images into one file, in exactly the order you want.',
  keywords: ['combine pdf', 'join pdf files', 'merge pdf files', 'combine pdf files into one', 'pdf merger', 'merge pdf and jpg', 'combine pdf and images', 'add pages to pdf'],
  island: 'MergePdf',
  steps: [
    'Drop in your PDFs, plus any JPG, PNG, WebP or HEIC images you want as pages.',
    'Drag the files into order, or switch to Pages to move, rotate or remove single pages.',
    'Name the file, choose bookmarks if you like, then merge and download.',
  ],
  faq: [
    {
      q: 'Is there a limit on how many files I can merge?',
      a: "No. There's no file count limit, no size cap and no daily limit. Everything runs on your device, so the only limit is your browser's memory. Big merges run in the background with a progress bar, so the page stays responsive.",
    },
    {
      q: 'Can I merge password-protected PDFs?',
      a: "Yes. You'll be asked for the password of each locked file. It's used only on your device to unlock the file, and the merged PDF has no password. Files that only restrict printing or editing open without one.",
    },
    {
      q: 'Can I add images to the PDF?',
      a: 'Yes. JPG, PNG, WebP, HEIC, AVIF and GIF images become one page each, sized to the picture (no wider than an A4 page) with no margins. JPGs go in as they are, without recompression, PNGs stay lossless, and phone photos keep the right way up.',
    },
    {
      q: 'What happens to links, bookmarks and forms?',
      a: "Page content, comments and web links are kept. Links that jump to another page of the same file keep working in many PDFs, but not all. Bookmarks inside the original files aren't carried over, but you can add one bookmark per file. Form fields are copied but may no longer be fillable, so fill in forms before merging.",
    },
    filePrivacyFaq,
  ],
  related: ['split-pdf', 'organize-pdf', 'compress-pdf', 'jpg-to-pdf'],
  flagship: { elsewhere: 'File and size caps, sign-up for more', here: 'Unlimited files, no size cap' },
} satisfies Tool;

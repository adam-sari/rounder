import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'split-pdf',
  category: 'pdf',
  name: 'Split PDF',
  title: 'Split PDF: by page ranges, every N pages or file size, free',
  h1: 'Split a *PDF*',
  description: 'Split a PDF by page ranges, every N pages, picked pages or file size. See which pages go into which file, then download as a ZIP. Nothing is uploaded.',
  tagline: 'Cut a PDF into smaller files and see exactly which pages land where.',
  keywords: ['split pdf', 'separate pdf pages', 'extract pages from pdf', 'split pdf by size', 'split pdf into multiple files', 'pdf splitter', 'split pdf every page', 'cut pdf'],
  island: 'SplitPdf',
  steps: [
    'Drop in a PDF. If it has a password, you\'ll be asked for it.',
    'Choose how to split it: custom ranges, every N pages, pages you click, or a maximum file size. Colors on the thumbnails show which file each page goes into.',
    'Click Split, then download the files one by one or all together as a ZIP.',
  ],
  faq: [
    {
      q: 'Can I split a PDF into files small enough to email?',
      a: 'Yes. Choose "By file size" and set the largest size you want, such as 10 MB. Each file is built and measured as it goes, so it stays at or under that size. A single page that\'s bigger than the limit on its own gets a file to itself, and you\'ll see a note next to it.',
    },
    {
      q: 'How do I type page ranges?',
      a: 'Separate ranges with commas: "1-3, 4-7, 8-" makes three PDFs, where "8-" means page 8 to the end. A single number like "5" makes a one-page PDF, and "odd", "even" and "last" work too. Pages left out of every range are listed so nothing goes missing by accident.',
    },
    {
      q: 'Does splitting change the quality of my pages?',
      a: 'No. Pages are copied as they are, so text stays sharp and selectable and images aren\'t recompressed. Document-wide extras such as bookmarks and fillable form setup aren\'t carried over, and a link to a page that ends up in a different file won\'t go anywhere.',
    },
    {
      q: 'Can I split a password-protected PDF?',
      a: 'Yes. Enter the password when asked and the file is unlocked on your device. The split files don\'t have a password. If the PDF only restricts editing or printing, it opens without asking.',
    },
    filePrivacyFaq,
  ],
  related: ['merge-pdf', 'organize-pdf', 'delete-pdf-pages', 'compress-pdf'],
  next: ['compress-pdf', 'merge-pdf'],
  flagship: { elsewhere: 'Daily task limits and upload size caps', here: 'Unlimited splits, any file size' },
} satisfies Tool;

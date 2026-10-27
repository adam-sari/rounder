import { MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'unlock-pdf',
  category: 'pdf',
  name: 'Unlock PDF',
  title: 'Unlock PDF: remove a PDF password & restrictions, free',
  h1: 'Unlock a *PDF*',
  description: 'Remove the password from a PDF you can open, or lift print, copy and edit restrictions. Works in your browser: no upload, no sign-up.',
  tagline: 'Take the password off a PDF you know the password to.',
  keywords: ['remove password from pdf', 'unlock pdf', 'pdf password remover', 'decrypt pdf', 'remove pdf restrictions', 'unsecure pdf', 'remove pdf protection', 'enable printing pdf'],
  island: 'UnlockPdf',
  steps: [
    'Drop one or more locked PDFs.',
    'Type each file\'s password when asked. PDFs that only restrict printing or copying need none.',
    'Download the unlocked copies, one by one or as a zip.',
  ],
  faq: [
    {
      q: 'Can you unlock a PDF if I forgot the password?',
      a: 'No. This tool removes a password you already know; it doesn\'t guess or crack passwords. Modern PDFs use AES encryption, so without the password the contents really are unreadable. If someone sent you the file, ask them for the password or an unprotected copy.',
    },
    {
      q: 'Do I need a password to remove printing or copying restrictions?',
      a: 'No. If a PDF opens without a password but won\'t let you print, copy or edit, it only has permission restrictions. Drop it in and you get a copy without them. Please only do this for documents you have the right to use that way.',
    },
    {
      q: 'Does unlocking change anything else?',
      a: 'No. Pages, text, images, links, bookmarks and form fields stay as they are. Only the encryption and the restrictions are removed, so the file usually ends up about the same size.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Password prompt', effect: 'Appears only for files that need a password to open. The password is checked by PDF.js on your device and handed to qpdf to decrypt.' },
      { name: 'Restrictions only', effect: 'Files that open freely but block printing, copying or editing need no password: qpdf rewrites them without the permission flags.' },
      { name: 'Checks first', effect: 'Each file is inspected before anything runs, and a PDF with no password or restrictions is reported as not locked instead of being copied for nothing.' },
    ],
    results: [{ input: '20-page report protected with AES-256, 2.2 MB', setting: 'With the password', output: 'unlocked copy, 2.2 MB', note: 'pages, text and images unchanged, 1–2 s' }],
    measured: MEASURED,
    formats: [
      { name: 'What qpdf removes', about: 'The encryption dictionary and the permission flags. Content, links, bookmarks and form fields are copied over as they are.' },
      { name: 'What it can\'t do', about: 'Recover a forgotten open password. AES-256 can\'t be bypassed, and this tool doesn\'t guess passwords.' },
    ],
  },
  related: ['protect-pdf', 'merge-pdf', 'compress-pdf', 'pdf-to-text'],
  next: ['edit-pdf', 'compress-pdf'],
  noAds: true,
  flagship: { elsewhere: 'Upload your file, often with a daily cap', here: 'Unlocked on your device, no limits' },
} satisfies Tool;

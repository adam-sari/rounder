import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'protect-pdf',
  category: 'pdf',
  name: 'Protect PDF',
  title: 'Protect PDF with a Password: AES-256, free, no upload',
  h1: 'Password-protect a *PDF*',
  description: 'Add a password to PDFs with AES-256 encryption and limit printing, copying or editing. Batch files, no sign-up, and nothing is uploaded.',
  tagline: 'Lock PDFs with a password, right in your browser.',
  keywords: ['password protect pdf', 'encrypt pdf', 'lock pdf', 'add password to pdf', 'secure pdf', 'pdf password', 'restrict pdf printing', 'prevent copying pdf'],
  island: 'ProtectPdf',
  steps: [
    'Drop one PDF or a whole batch.',
    'Choose an open password and, if you like, limit printing, copying or editing.',
    'Protect, then download each file or all of them as a zip.',
  ],
  faq: [
    {
      q: 'How strong is the protection?',
      a: 'Files are encrypted with 256-bit AES, the strongest method in the PDF standard, using qpdf running in your browser. Without the open password the contents can\'t be read. The real weak point is the password itself, so pick a long one: the meter shows roughly how hard it is to guess.',
    },
    {
      q: 'What if I forget the password?',
      a: 'Then the PDF can\'t be opened again. There is no reset and no copy on our side, because the file never leaves your device. Keep the password in a password manager, and keep your original unprotected copy somewhere safe if you may need it.',
    },
    {
      q: 'What is the difference between the open password and permissions?',
      a: 'The open password encrypts the file: nobody can view it without the password. Permissions (no printing, copying, editing or commenting) are flags that PDF apps are asked to respect. Acrobat and many other readers do, but some apps (including some browser viewers) ignore them, so use an open password for anything private. The optional permissions password lets you change the permissions later in apps like Acrobat.',
    },
    {
      q: 'Can I protect several PDFs at once?',
      a: 'Yes. Drop as many as you like and they all get the same password and settings. Download them one by one or together as a zip. There is no daily limit and no file size cap from us.',
    },
    filePrivacyFaq,
  ],
  related: ['unlock-pdf', 'file-encryptor', 'watermark-pdf', 'compress-pdf'],
  noAds: true,
  flagship: { elsewhere: 'Upload your file, often with a daily cap', here: 'Encrypted on your device, no limits' },
} satisfies Tool;

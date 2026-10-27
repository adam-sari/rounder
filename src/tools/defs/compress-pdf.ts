import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'compress-pdf',
  category: 'pdf',
  name: 'Compress PDF',
  title: 'Compress PDF: reduce PDF file size free, no upload',
  h1: 'Compress *PDF*',
  description: 'Shrink PDF files in your browser. Downscale photos, recompress images and optimize the file structure in bulk. No upload, no sign-up, no limits.',
  tagline: 'Make PDFs small enough to email, with text that stays crisp.',
  keywords: ['reduce pdf size', 'pdf compressor', 'shrink pdf', 'make pdf smaller', 'pdf size reducer', 'compress pdf for email', 'optimize pdf', 'compress large pdf'],
  island: 'CompressPdf',
  steps: [
    'Drop in one or more PDFs. If a file is password-protected, you will be asked for its password.',
    'Pick a level: Light is lossless, while Recommended and Strong downscale photos for much smaller files.',
    'Compare the before and after sizes, then download each PDF or all of them as a zip.',
  ],
  faq: [
    {
      q: 'How much smaller will my PDF get?',
      a: 'It depends on what is inside. PDFs made of scans or photos usually shrink the most, because their images are downscaled to the chosen resolution and saved again as JPEG. Text-only PDFs are often compact already, so they shrink less. If a file can\'t be made smaller, you get the original back.',
    },
    {
      q: 'Will the text stay sharp?',
      a: 'Yes. Text, fonts and vector drawings are never turned into pictures, so they stay as crisp as before. Only photos are resampled. Charts, line art and images with few colors are left lossless, and the Light level doesn\'t change any pixels at all.',
    },
    {
      q: 'What do the levels do?',
      a: 'Light repacks the file and recompresses its data without touching image quality. Recommended brings photos down to 150 dpi at JPEG quality 75, which looks good on screen and in everyday printing. Strong uses 100 dpi at quality 60 for the smallest files, best for reading on screen. Custom lets you pick both numbers.',
    },
    {
      q: 'Can I compress a password-protected PDF?',
      a: 'Yes. Enter the password when asked. The compressed copy is saved without the password, so use Protect PDF afterwards if you want to lock it again.',
    },
    filePrivacyFaq,
  ],
  related: ['merge-pdf', 'protect-pdf', 'split-pdf', 'image-compressor'],
  next: ['protect-pdf', 'sign-pdf'],
  flagship: { elsewhere: 'Daily task limits and file size caps', here: 'Unlimited PDFs, no size cap' },
} satisfies Tool;

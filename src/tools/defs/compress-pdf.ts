import { LIMITS, MEASURED } from '../lib/notes';
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
  notes: {
    settings: [
      { name: 'Light', effect: 'Repacks the file with qpdf: objects go into compressed streams and every Flate stream is squeezed again at level 9. No pixel changes, so scans and photo PDFs barely shrink.' },
      { name: 'Recommended / Strong', effect: 'Photos are scaled down to 150 dpi (Recommended) or 100 dpi (Strong) at the largest size they appear on any page, then saved as JPEG at quality 75 or 60. A photo is only replaced when the new copy is smaller.' },
      { name: 'Custom', effect: 'Pick the resolution (50–300 dpi) and the JPEG quality (30–95) yourself.' },
      { name: 'Target size', effect: 'Instead of a level, give a limit in KB: the tool steps down resolution and quality until the PDF fits, and says so when it can\'t. 1 KB counts as 1,000 bytes.' },
      { name: 'Grayscale images', effect: 'Drops the color from photos only; text and vector drawings keep theirs.' },
      { name: 'Remove metadata', effect: 'Deletes the title, author, creator software and XMP block.' },
    ],
    results: [
      { input: '10-page color scan at 300 dpi, 15 MB', setting: 'Recommended', output: '3.5 MB', note: '−77%, 2.4 s' },
      { input: '10-page color scan at 300 dpi, 15 MB', setting: 'Strong', output: '1.4 MB', note: '−91%, still readable on screen' },
      { input: '10-page color scan at 300 dpi, 15 MB', setting: 'Light', output: '15 MB', note: '−0%: lossless can\'t shrink scanned pages' },
      { input: '20-page report with photos and charts, 2.3 MB', setting: 'Recommended', output: '631 KB', note: '−73%, text untouched' },
      { input: '20-page report with photos and charts, 2.3 MB', setting: 'Strong', output: '372 KB', note: '−84%' },
      { input: '4 phone photos made into a PDF, 11 MB', setting: 'Recommended', output: '1.1 MB', note: '−91%' },
      { input: '10-page color scan at 300 dpi, 15 MB', setting: 'Target size, under 1 MB', output: '873 KB', note: 'photos at 85 dpi, quality 45; 17.5 s' },
      { input: '10-page color scan at 300 dpi, 15 MB', setting: 'Target size, under 500 KB', output: '333 KB', note: 'photos at 60 dpi, quality 35; the tool warns to check that small print still reads' },
      { input: '20-page report with photos and charts, 2.3 MB', setting: 'Target size, under 200 KB', output: '248 KB, doesn\'t fit', note: 'its text, fonts and drawings alone take about 217 KB; the tool says so and suggests grayscale or splitting it' },
      { input: '64-page library scan using JPEG 2000 and JBIG2 images, 2.5 MB', setting: 'Recommended', output: '2.4 MB', note: '−1%: those image types are already compact and left as they are' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'Scanned PDFs', about: 'Each page is one big picture, so downscaling it is where the savings are. Expect the biggest drops here.' },
      { name: 'Digital PDFs', about: 'Text and vector drawings from Word, Google Docs or a website are already compact. Only the photos inside them shrink.' },
      { name: 'Images left alone', about: 'JPEG 2000, JBIG2, CMYK and masked images, and anything under 10 KB, are copied as they are: re-encoding them risks more than it saves.' },
    ],
    limits: [LIMITS.gmail, LIMITS.yahoo, LIMITS.outlook, LIMITS.exchange],
  },
  related: ['merge-pdf', 'protect-pdf', 'split-pdf', 'image-compressor'],
  next: ['protect-pdf', 'sign-pdf'],
  flagship: { elsewhere: 'Daily task limits and file size caps', here: 'Unlimited PDFs, no size cap' },
} satisfies Tool;

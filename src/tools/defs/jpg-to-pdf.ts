import { LIMITS, MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'jpg-to-pdf',
  category: 'pdf',
  name: 'Images to PDF',
  title: 'JPG to PDF Converter: combine images into one PDF, free',
  h1: 'Images to *PDF*',
  description: 'Turn JPG, PNG, WebP, HEIC and GIF images into a PDF. Reorder by dragging, pick A4 or Letter, margins and fit. No upload, no file limits.',
  tagline: 'Photos, scans and screenshots into one tidy PDF, in the order you choose.',
  keywords: ['jpg to pdf', 'image to pdf', 'png to pdf', 'convert jpg to pdf', 'combine images into pdf', 'photos to pdf', 'heic to pdf', 'multiple images to one pdf'],
  island: 'ImagesToPdf',
  steps: [
    'Drop in your images: JPG, PNG, WebP, HEIC or GIF, as many as you like.',
    'Drag them into order, then pick the page size, orientation and margins. Each thumbnail shows how its page will look.',
    'Create the PDF and download it, or make one PDF per image as a zip.',
  ],
  faq: [
    { q: 'Will my photos lose quality?', a: 'Not unless you ask. JPGs go into the PDF exactly as they are, without re-saving, and PNGs stay lossless. Photos that need turning upright, and formats a PDF can\'t hold directly like HEIC and WebP, are re-saved once at high quality.' },
    { q: 'How do I make the PDF smaller?', a: 'Turn on Compress images. Every image is re-saved as JPG at the quality you pick (see-through areas turn white), and any larger than 2500 pixels are scaled down, which is still about 210 dpi across an A4 page. Phone photos often shrink to a fraction of their size.' },
    { q: 'What does "Fit image" page size do?', a: 'Each page takes the exact shape of its image, so nothing is cropped and there are no white borders unless you add a margin. A4 and Letter put every image on a standard page instead, which is better for printing.' },
    { q: 'What\'s the difference between Whole image and Fill page?', a: 'Whole image shows the entire picture and leaves white space where the shapes differ. Fill page covers the page edge to edge (inside the margins) and hides whatever sticks out. The hidden parts are masked, not cut away, so don\'t rely on Fill page to remove anything private.' },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Page size', effect: 'A4 (default) or Letter put every image on a standard page; "Fit image" makes each page exactly the size of its picture.' },
      { name: 'Orientation', effect: 'Auto turns the page to landscape for wide images and portrait for tall ones; or force one for every page.' },
      { name: 'Margin', effect: 'None, small (0.25 in) or big (0.5 in) of white space around each image.' },
      { name: 'Image on the page', effect: 'Whole image shrinks it to fit inside the page; Fill page covers the page and trims what overflows.' },
      { name: 'Compress images', effect: 'Off, upright JPGs and PNGs go in byte for byte. On, every image is re-saved as JPG at the quality you set (default 75) and anything over 2500 px is scaled down, about 210 dpi across an A4 page.' },
      { name: 'Output', effect: 'One PDF with every image, or one PDF per image (downloaded as a zip).' },
    ],
    results: [
      { input: '4 phone photos (three 12 MP, one 1000×750), 11 MB', setting: 'Defaults (A4, originals kept)', output: '11 MB, 4 pages', note: 'the JPGs go in untouched, 0.2 s' },
      { input: '4 phone photos (three 12 MP, one 1000×750), 11 MB', setting: 'Compress images, quality 75', output: '2.0 MB, 4 pages', note: 'photos capped at 2500 px, 10 s' },
      { input: '3 HEIC photos from a phone, 9.5 MB', setting: 'Defaults', output: '9.0 MB, 3 pages', note: 'HEIC can\'t go in a PDF as is, so each is decoded and saved as a quality-92 JPG first, 20–24 s' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'JPG', about: 'PDF stores JPG data natively, so photos go in without any loss.' },
      { name: 'PNG', about: 'Also stored losslessly, transparency and all; screenshots and scans of text stay crisp.' },
      { name: 'HEIC, WebP, AVIF, GIF, BMP', about: 'PDF can\'t hold these directly. They are decoded and re-saved: graphics and see-through images as PNG, photos as JPG at quality 92.' },
    ],
    limits: [LIMITS.gmail, LIMITS.outlook, LIMITS.yahoo],
  },
  related: ['pdf-to-jpg', 'merge-pdf', 'compress-pdf', 'heic-to-jpg'],
  next: ['merge-pdf', 'compress-pdf'],
  flagship: { elsewhere: 'Daily task limits and upload size caps', here: 'Any number of images, built on your device' },
} satisfies Tool;

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
  related: ['pdf-to-jpg', 'merge-pdf', 'compress-pdf', 'heic-to-jpg'],
  flagship: { elsewhere: 'Daily task limits and upload size caps', here: 'Any number of images, built on your device' },
} satisfies Tool;

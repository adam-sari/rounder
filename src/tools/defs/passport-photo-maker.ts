import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'passport-photo-maker',
  category: 'image',
  name: 'Passport photo maker',
  title: 'Passport Photo Maker: free 2x2 & 35x45 mm photos to print',
  h1: 'Passport photo *maker*',
  description: 'Make passport and visa photos for the US, UK, EU, Canada, India, China and more. Line up the guide, then download a JPG or a 4×6 print sheet. Free.',
  tagline: 'Crop to the official size with a head guide, then print a sheet of copies.',
  keywords: ['passport photo', '2x2 photo', 'passport photo online', 'visa photo', '35x45 mm photo', 'us passport photo', 'passport size photo', 'passport photo 4x6 print', 'id photo maker'],
  island: 'PassportPhoto',
  steps: [
    'Drop in a photo taken straight on, against a plain light wall.',
    'Pick your country and document, then drag, zoom and straighten until your head fits the guide.',
    'Download the digital JPG, or a 4×6, A4 or Letter sheet of copies with cut lines to print.',
  ],
  faq: [
    { q: 'Will my photo be accepted?', a: 'The tool crops to the size and head position each authority publishes, but acceptance also depends on things it can\'t judge for you: even lighting, a neutral expression, open eyes, no glasses glare and a plain background. Check your document\'s official rules before you submit; the issuing office has the final say.' },
    { q: 'How do I print it?', a: 'Download the 4×6 sheet and order a standard 4×6 photo print at any photo lab, drugstore or online printer, then cut along the grey lines. For A4 or Letter, print on photo paper at 100% or "actual size", not "fit to page", so each photo comes out at the exact size.' },
    { q: 'Does it remove or change the background?', a: 'No, not in this version. Take the photo against a plain white or light grey wall with even light. The background check reads the area beside your head and tells you if it looks too dark, uneven or tinted.' },
    { q: 'Can I use the digital photo for an online application?', a: 'Yes. The digital download is a JPG at the exact pixel size of the printed photo at 300 dpi, for example 600 × 600 px for a 2×2 inch US photo. Online forms sometimes set their own file size limits, so check the upload rules on the form.' },
    filePrivacyFaq,
  ],
  related: ['crop-image', 'image-resizer', 'heic-to-jpg', 'image-compressor'],
  flagship: { elsewhere: '$5–15 to download each photo', here: 'Free, unlimited and print-ready' },
} satisfies Tool;

import { LIMITS, MEASURED } from '../lib/notes';
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
  notes: {
    settings: [
      { name: 'Document', effect: 'Sets the photo size and the head-size guide: 2×2 in for the US and Indian visas; 35×45 mm for the UK, Schengen, India, Australia and Japan; 50×70 mm for Canada; 33×48 mm for China. Each guide follows the rules its government publishes.' },
      { name: 'Guide lines', effect: 'Top of head on the top line, chin in the yellow band, eyes in the green band. Zoom, drag and straighten (up to 20°) until they line up; the photo must cover the whole frame.' },
      { name: 'Checks', effect: 'Reads the background in the corners beside your head and warns when it looks too dark or uneven. It doesn\'t replace the background.' },
      { name: 'Paper', effect: 'Tiles as many photos as fit on 4×6 in, A4 or Letter at 300 dpi, saved as JPG or PNG for a photo kiosk or home printer.' },
    ],
    results: [
      { input: '12 MP portrait photo (3024×4032), JPG, 3.0 MB', setting: 'US 2×2 in', output: '600×600 JPG, 171 KB', note: 'tagged 300 dpi; inside the 54 KB to 10 MB the US online renewal accepts' },
      { input: 'The same photo', setting: 'US 2×2 in on a 4×6 in sheet', output: '1200×1800 JPG with 6 photos, 1.0 MB', note: 'packed edge to edge; prints at true size on 4×6 in paper' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'Single photo (JPG)', about: 'For online applications and print shops: exact pixel size at 300 dpi, JPG quality 92.' },
      { name: 'Print sheet', about: 'Several copies on one sheet; print it at 100% (no "fit to page") so each photo comes out the right size.' },
    ],
    limits: [LIMITS.passport],
  },
  related: ['crop-image', 'image-resizer', 'heic-to-jpg', 'image-compressor'],
  next: ['image-compressor', 'jpg-to-pdf'],
  flagship: { elsewhere: '$5–15 to download each photo', here: 'Free, unlimited and print-ready' },
} satisfies Tool;

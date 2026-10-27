import { LIMITS, MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'image-compressor',
  category: 'image',
  name: 'Image compressor',
  title: 'Image Compressor: shrink JPG, PNG, WebP & AVIF, no limits',
  h1: 'Image *compressor*',
  description: 'Compress JPG, PNG, WebP, AVIF and HEIC images in bulk. Smart PNG color reduction, before/after preview, no file limits and nothing uploaded.',
  tagline: 'Shrink photos and screenshots in bulk, with a before/after preview.',
  keywords: ['compress jpg', 'compress png', 'reduce image size', 'tinypng', 'optimize images', 'shrink photo', 'compress jpeg', 'kb'],
  island: 'ImageCompressor',
  steps: [
    'Drop in as many images as you like (JPG, PNG, WebP, AVIF or HEIC).',
    'Pick a quality, or switch format: WebP and AVIF are often half the size of JPG.',
    'Drag the slider to compare before and after, then download one by one or as a zip.',
  ],
  faq: [
    { q: 'How much smaller will my images get?', a: 'Photos usually shrink by 50–80% at quality 75 with no visible difference. PNG screenshots shrink by 60–80% with smart color reduction, which works like TinyPNG by reducing the image to its 256 most important colors.' },
    { q: 'Is there a limit on files or size?', a: 'No daily limit, no file cap and no size cap. Everything runs on your device, so the only limit is your computer\'s memory.' },
    { q: 'Does compressing remove photo metadata?', a: 'Yes. Re-encoding drops EXIF data such as GPS location and camera details, which is good for privacy when sharing photos online.' },
    { q: 'Which format should I pick?', a: 'Keep "same" to stay compatible everywhere. WebP works in every modern browser and is usually 25–35% smaller than JPG. AVIF is smaller still but slower to encode.' },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Output format', effect: '"same" keeps each file\'s format (HEIC photos come out as JPG). JPG, PNG, WebP or AVIF re-encode every file into that format.' },
      { name: 'Quality (10–100, default 75)', effect: 'The encoder quality for JPG (MozJPEG), WebP and AVIF. Lower values throw away more fine detail for a smaller file. PNG ignores it.' },
      { name: 'Smart PNG color reduction', effect: 'Cuts PNGs down to at most 256 colors with dithering before OxiPNG packs them, the TinyPNG approach. Off, PNGs are only repacked losslessly.' },
      { name: 'Shrink large images to', effect: 'Caps the longest side at 4K (3840), 2560, 1920 or 1280 pixels, keeping the proportions. Smaller images are never enlarged.' },
      { name: 'Never make a file bigger', effect: 'When re-encoding in the same format at full size doesn\'t make a file smaller, you get the original back, marked "already optimal".' },
    ],
    results: [
      { input: '12 MP phone photo of a street, JPG, 4.0 MB', setting: 'Defaults (same format, quality 75)', output: '1.0 MB', note: '−74%, 1.9 s' },
      { input: 'A busier 12 MP street photo, JPG, 4.0 MB', setting: 'Defaults', output: '2.0 MB', note: '−51%: more fine detail costs more bytes' },
      { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'Shrink to 1920', output: '300 KB at 1920×1440', note: '−93%, 4.4 s' },
      { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'WebP, quality 75', output: '838 KB', note: '3.4 s' },
      { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'AVIF, quality 75', output: '1.2 MB', note: '29.7 s: AVIF is far slower to encode' },
      { input: '1920×1080 screenshot of a web page, PNG, 173 KB', setting: 'Defaults (256 colors)', output: '71 KB', note: '−59%, 1.4 s' },
      { input: 'The same 12 MP photo saved as PNG, 12 MB', setting: 'Defaults (256 colors)', output: '5.7 MB', note: 'still big: save photos as JPG or WebP instead' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'JPG', about: 'The safe choice for photos: every app, site and printer opens it. No transparency.' },
      { name: 'PNG', about: 'Lossless, with transparency. Right for screenshots, logos and graphics; photos stay large even after color reduction.' },
      { name: 'WebP', about: 'Smaller than JPG at a similar look (838 KB against 1.0 MB on our test photo) and supports transparency. Every current browser shows it; some older apps and upload forms don\'t accept it.' },
      { name: 'AVIF', about: 'Often the smallest at the same look, but its quality scale differs from JPG\'s: at 75 it came out bigger than WebP on our test photo, while 65 (the image converter\'s default) gave 910 KB. Slow to encode, and many apps and forms don\'t accept it yet.' },
    ],
    limits: [LIMITS.gmail, LIMITS.outlook, LIMITS.passport],
  },
  related: ['image-converter', 'image-resizer', 'heic-to-jpg'],
  next: ['image-resizer', 'exif-remover'],
  flagship: { elsewhere: '20 images a day, 5 MB each', here: 'Unlimited images, any size' },
} satisfies Tool;

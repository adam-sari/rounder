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
  related: ['image-converter', 'image-resizer', 'heic-to-jpg'],
  next: ['image-resizer', 'exif-remover'],
  flagship: { elsewhere: '20 images a day, 5 MB each', here: 'Unlimited images, any size' },
} satisfies Tool;

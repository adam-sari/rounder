import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'watermark-image',
  category: 'image',
  name: 'Watermark image',
  title: 'Watermark Images: add text or a logo to photos in bulk',
  h1: 'Watermark *images*',
  description: 'Add a text or logo watermark to many photos at once. Pick a corner, center or tiled pattern, set opacity and rotation. Full resolution, nothing uploaded.',
  tagline: 'Stamp your name or logo on a whole batch of photos, with a live preview.',
  keywords: ['add watermark to photo', 'batch watermark', 'watermark photos in bulk', 'logo watermark', 'text watermark', 'watermark maker', 'copyright watermark', 'watermark png'],
  island: 'WatermarkImage',
  steps: [
    'Drop in the photos you want to mark, as many as you like.',
    'Type your text or upload a logo, then pick a position or a tiled pattern and tune size, opacity and rotation.',
    'Check the live preview, then download each photo or all of them as a zip.',
  ],
  faq: [
    { q: 'Will the watermark look the same on photos of different sizes?', a: 'Yes. Size is a share of each photo\'s width and the margin is a share of its shorter side, so a small phone shot and a large camera photo get a mark in the same proportions and spot.' },
    { q: 'Can I use my own logo?', a: 'Yes. Switch to Logo and upload a PNG, SVG, WebP or JPG. A PNG with a transparent background or an SVG gives the cleanest result, and SVG logos stay sharp at any size.' },
    { q: 'Does it lower the quality or size of my photos?', a: 'Photos keep their full resolution. JPG and WebP are saved at the quality you pick (90 by default) and PNG stays lossless. Saving drops metadata such as camera details and GPS location.' },
    { q: 'Can a watermark be removed?', a: 'A watermark puts people off casual copying, but someone determined can crop or edit out a small corner mark. A tiled pattern across the whole photo is much harder to remove.' },
    filePrivacyFaq,
  ],
  related: ['image-resizer', 'image-compressor', 'exif-remover', 'crop-image'],
  flagship: { elsewhere: 'Batch caps, sign-ups or their own logo on your photos', here: 'Unlimited photos, only your mark' },
} satisfies Tool;

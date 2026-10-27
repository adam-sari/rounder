import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'collage-maker',
  category: 'image',
  name: 'Collage maker',
  title: 'Photo Collage Maker: free, no watermark, no sign-up',
  h1: 'Photo *collage* maker',
  description: 'Make a photo collage from 2 to 9 pictures. Pick a layout, drag to frame each photo, set spacing and corners, and download a full-size JPG or PNG.',
  tagline: 'Two to nine photos, one tidy grid. Drag to frame, download at full size.',
  keywords: ['photo collage', 'picture collage', 'collage maker no watermark', 'photo grid', 'combine photos', 'put pictures together', 'instagram collage', 'side by side photos', 'free collage maker'],
  island: 'CollageMaker',
  steps: [
    'Drop in 2 to 9 photos (JPG, PNG, WebP or HEIC) and pick a layout.',
    'Drag inside a cell to frame the photo, zoom in, or drag ⇄ onto another cell to swap.',
    'Choose the shape, spacing, corners and background, then download a JPG or PNG.',
  ],
  faq: [
    { q: 'Will my collage have a watermark?', a: 'No. There is no watermark, no sign-up and no limit on how many collages you make.' },
    { q: 'What size is the downloaded collage?', a: 'You choose the long side: 1080, 2160 or 3840 pixels. The short side follows the shape you pick, so a 4:5 collage at 2160 comes out at 1728 × 2160. Photos are redrawn from the originals, so they stay sharp.' },
    { q: 'Which shape should I use for Instagram or stories?', a: '4:5 fills the most space in an Instagram feed, 1:1 is the classic square, and 9:16 fits stories, reels and phone wallpapers. 16:9 suits slides and YouTube thumbnails.' },
    { q: 'Can I make the background transparent?', a: 'Yes. Pick the checkered swatch and download a PNG or WebP. JPG has no transparency, so a JPG saves with a white background instead.' },
    filePrivacyFaq,
  ],
  related: ['instagram-grid-maker', 'image-resizer', 'crop-image', 'image-compressor'],
  flagship: { elsewhere: 'Watermarks or sign-up to download', here: 'Full-size download, no watermark' },
} satisfies Tool;

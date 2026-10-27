import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'crop-image',
  category: 'image',
  name: 'Crop image',
  title: 'Crop Image Online: free photo cropper with circle crop',
  h1: '*Crop* an image',
  description: 'Crop photos to exact pixels or ratios like 1:1, 4:5 and 16:9. Circle crop for profile pictures, rotate and flip, full-quality output, nothing uploaded.',
  tagline: 'Drag a box, pick a ratio or type exact pixels. Full resolution out.',
  keywords: ['crop photo', 'crop jpg', 'crop png', 'circle crop', 'crop image to square', 'profile picture crop', 'crop picture', 'image cropper', 'crop 16:9'],
  island: 'CropImage',
  steps: [
    'Drop in a photo or screenshot (JPG, PNG, WebP, HEIC, AVIF or SVG).',
    'Drag the box or its handles, pick a ratio like 1:1 or 9:16, or type the exact size. Rotate, flip or switch to a circle if you need to.',
    'Choose JPG, PNG or WebP and download the crop at full resolution.',
  ],
  faq: [
    { q: 'Does cropping lower the quality?', a: 'The crop is cut from your full-resolution image, not the smaller preview, so every pixel inside the box is kept. PNG output is lossless. JPG and WebP are re-encoded at the quality you choose, 92 by default, which is very hard to tell apart from the original.' },
    { q: 'How do I make a round profile picture?', a: 'Choose the circle shape. The box locks to a square, and the download is a PNG with transparent corners, ready for avatars and profile photos. Pick another ratio if you want an oval instead.' },
    { q: 'Can I crop to an exact pixel size?', a: 'Yes. Type the width, height and position in the boxes next to the image. With a ratio locked, changing the width updates the height to match. Use the arrow keys to nudge the box by one pixel, or hold Shift for bigger steps.' },
    { q: 'Can I crop iPhone HEIC photos?', a: 'Yes. HEIC and AVIF photos open right in the browser, the right way up, and you can save the crop as JPG, PNG or WebP.' },
    filePrivacyFaq,
  ],
  related: ['image-resizer', 'rotate-image', 'passport-photo-maker', 'instagram-grid-maker'],
} satisfies Tool;

import { LIMITS, MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'image-resizer',
  category: 'image',
  name: 'Image resizer',
  title: 'Image Resizer: resize photos in bulk by pixels, percent or KB',
  h1: 'Image *resizer*',
  description: 'Resize JPG, PNG, WebP and HEIC images in bulk by percent, exact pixels or social media presets, or shrink them under a file size in KB. Nothing uploaded.',
  tagline: 'Resize a whole batch at once, to exact pixels, a percentage or a file size limit.',
  keywords: ['resize image', 'photo resizer', 'bulk image resizer', 'resize image to 100kb', 'reduce image size in kb', 'change image dimensions', 'resize image for instagram', 'resize image to 1920x1080', 'image size reducer'],
  island: 'ImageResizer',
  steps: [
    'Drop in as many images as you like (JPG, PNG, WebP, AVIF or HEIC).',
    'Pick how to resize: by percent, to fit a box, to an exact size or preset, or under a file size in KB.',
    'Check the new dimensions next to each file, then download them one by one or as a zip.',
  ],
  faq: [
    { q: 'How do I get a photo under 100 KB or 200 KB for a form?', a: 'Choose "file size (KB)" and pick the limit. The tool looks for the highest JPG or WebP quality that fits, and only makes the picture smaller in pixels if lowering the quality isn\'t enough. It counts 1 KB as 1,000 bytes, so the result passes upload forms that use either definition.' },
    { q: 'What\'s the difference between fit, crop to fill and stretch?', a: '"Fit in box" keeps the proportions and makes the image as large as it can be inside your width and height, so one side may come out shorter. "Crop to fill" gives you exactly the size you typed and trims the overflow evenly from the edges. "Stretch" also gives the exact size but squashes the image when the shapes differ.' },
    { q: 'Will resizing make my photos blurry?', a: 'Shrinking keeps photos sharp because it uses Lanczos resampling, a high-quality method that preserves edges. Enlarging can\'t add detail that was never there, which is why "don\'t enlarge small images" is on by default.' },
    { q: 'Does resizing keep the photo\'s EXIF data?', a: 'No. Each resized image is re-encoded, which drops EXIF data such as GPS location and camera details. Photos are turned the right way up first, so they don\'t end up sideways. One exception: in "file size (KB)" mode, a file that is already under the limit in the chosen format is passed through untouched, metadata and all.' },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Percent', effect: 'Scales width and height by the same percentage, so 50% leaves a quarter of the pixels.' },
      { name: 'Fit in box (default 1920×1080)', effect: 'The largest size that fits inside the box with the proportions kept. "Don\'t enlarge" leaves smaller images as they are.' },
      { name: 'Exact size', effect: 'Exactly the width and height you type: crop to fill trims the overflow from the center, otherwise the picture is stretched. Width and height also work in cm, mm or inches at a DPI you set, which is written into the JPG.' },
      { name: 'File size (KB)', effect: 'Searches JPG or WebP quality for the best result at or under your limit (or between a minimum and maximum), and only shrinks the pixels when quality alone can\'t get there. 1 KB counts as 1,000 bytes.' },
      { name: 'Format and quality', effect: '"Same" keeps each file\'s format; quality (default 85) applies to JPG and WebP.' },
    ],
    results: [
      { input: '12 MP phone photo (4032×3024), JPG, 4.0 MB', setting: 'Fit in 1920×1080 (default)', output: '265 KB at 1440×1080', note: '1.9 s' },
      { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'Percent, 50%', output: '495 KB at 2016×1512', note: '4.4 s' },
      { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'File size, under 200 KB', output: '192 KB at 1895×1421', note: 'quality 56 and shrunk to fit, 27.8 s' },
      { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'File size, under 100 KB', output: '94 KB at 1326×995', note: 'quality 53, 21.7 s' },
      { input: '12 MP portrait photo (3024×4032), JPG, 3.0 MB', setting: 'File size, under 100 KB', output: '97 KB at 861×1147', note: 'quality 50, 21.2 s' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'JPG', about: 'The format upload forms expect, and the default in file-size mode. Its quality setting is what the size search turns.' },
      { name: 'WebP', about: 'Reaches the same KB limit with more detail, if the form accepts it.' },
      { name: 'PNG', about: 'Lossless, so it only shrinks by losing pixels. Not offered in file-size mode for that reason.' },
    ],
    limits: [LIMITS.passport, LIMITS.gmail],
  },
  related: ['image-compressor', 'crop-image', 'image-converter', 'passport-photo-maker'],
  next: ['image-compressor', 'crop-image'],
  flagship: { elsewhere: 'Batch caps and uploads to a server', here: 'Unlimited files, resized on your device' },
} satisfies Tool;

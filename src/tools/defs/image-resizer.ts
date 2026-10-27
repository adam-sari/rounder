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
  related: ['image-compressor', 'crop-image', 'image-converter', 'passport-photo-maker'],
  next: ['image-compressor', 'crop-image'],
  flagship: { elsewhere: 'Batch caps and uploads to a server', here: 'Unlimited files, resized on your device' },
} satisfies Tool;

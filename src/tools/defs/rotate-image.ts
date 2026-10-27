import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'rotate-image',
  category: 'image',
  name: 'Rotate image',
  title: 'Rotate Image Online: rotate, flip & straighten photos in bulk',
  h1: 'Rotate *image*',
  description: 'Rotate images 90° or 180°, flip them, or straighten a tilted horizon by the degree. Works on many photos at once, nothing uploaded.',
  tagline: 'Turn, flip or straighten a whole batch of photos in one go.',
  keywords: ['rotate image', 'rotate photo', 'flip image', 'mirror image', 'straighten photo', 'rotate jpg', 'rotate picture 90 degrees', 'fix sideways photo'],
  island: 'RotateImage',
  steps: [
    'Drop in one photo or a whole batch (JPG, PNG, WebP, AVIF or HEIC).',
    'Turn or flip with the buttons, or drag the straighten slider to level a tilted shot.',
    'Download each image, or all of them as a zip.',
  ],
  faq: [
    { q: 'Why does my photo look sideways in some apps but not others?', a: 'Phones usually save the picture in the sensor\'s orientation and add an EXIF tag saying which way is up. Some apps and websites ignore that tag. This tool bakes the orientation into the pixels, so the result displays the right way everywhere, even with no changes applied.' },
    { q: 'What happens to the corners when I straighten a photo?', a: 'Tilting leaves empty triangles at the corners. "Crop" trims the image to the largest rectangle with the same shape that has no empty corners. "Fill" keeps every pixel and paints the corners a color you pick, and "transparent" leaves them see-through (saved as PNG if the format can\'t do transparency).' },
    { q: 'Does rotating reduce quality?', a: 'PNG output is lossless. JPG, WebP and AVIF are saved again at high quality (92), which is very hard to tell apart from the original. Quarter turns and flips keep every pixel. Straightening resamples the photo, and either trims the edges (crop) or makes the canvas a little bigger to fit the corners (fill or transparent).' },
    { q: 'Does it keep my photo\'s metadata?', a: 'No. Saving the rotated image drops EXIF data such as camera details and GPS location, which is handy for privacy when sharing.' },
    filePrivacyFaq,
  ],
  related: ['crop-image', 'image-resizer', 'image-converter', 'exif-remover'],
  next: ['crop-image', 'image-compressor'],
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'pixel-art-maker',
  category: 'image',
  name: 'Pixelate image / pixel art',
  title: 'Pixel Art Maker: pixelate a photo with retro palettes',
  h1: 'Pixel *art* maker',
  description: 'Turn a photo into pixel art. Pick the grid size, reduce colors or use Game Boy, PICO-8, NES or CGA palettes, add dithering and export a crisp PNG.',
  tagline: 'Pixelate a photo into retro sprite-style art with real palettes and dithering.',
  keywords: ['pixelate image', 'photo to pixel art', 'pixel art converter', '8-bit image', 'pixelator', 'game boy filter', 'pico-8 palette', 'dithering'],
  island: 'PixelArt',
  steps: [
    'Drop in a photo (JPG, PNG, WebP or HEIC).',
    'Set how many pixels across, then pick a palette and an optional dithering style.',
    'Choose an export size and download a crisp PNG.',
  ],
  faq: [
    {
      q: 'What do the palettes do?',
      a: 'Auto works out a set of colors that suits your photo, up to the number you choose. Grayscale uses evenly spaced shades. Game Boy, PICO-8, NES and CGA limit the image to the colors those systems are known for, so every pixel snaps to the nearest one. Original keeps the averaged colors with no reduction.',
    },
    {
      q: 'What is dithering?',
      a: 'With only a few colors, smooth gradients turn into hard bands. Dithering mixes neighboring palette colors in a pattern so your eye blends them into in-between tones. Ordered dithering makes a regular crosshatch typical of old games; Floyd–Steinberg gives a finer, grainier texture.',
    },
    {
      q: 'Why does the preview stay sharp instead of blurry?',
      a: 'Each pixel is enlarged with nearest-neighbor scaling, which copies it into a solid square rather than smoothing it into its neighbors. The download uses the same method, so the 4×, 8× and 16× files keep hard pixel edges.',
    },
    {
      q: 'Does it keep transparency?',
      a: 'Yes. Transparent areas of a PNG stay transparent, and partly transparent edges are snapped to fully on or off so the outline stays crisp like a sprite.',
    },
    filePrivacyFaq,
  ],
  related: ['image-to-ascii', 'image-resizer', 'favicon-generator'],
} satisfies Tool;

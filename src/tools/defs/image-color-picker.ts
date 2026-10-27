import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'image-color-picker',
  category: 'image',
  name: 'Image color picker & palette',
  title: 'Image Color Picker: get HEX, RGB & palette from any photo',
  h1: 'Image color *picker*',
  description: 'Pick any color from an image with a pixel magnifier. Get HEX, RGB, HSL and OKLCH, plus the dominant palette as CSS, Tailwind or JSON. Nothing uploaded.',
  tagline: 'Zoom in on any pixel, copy its color, and pull the main palette from the image.',
  keywords: ['color picker from image', 'hex color from image', 'eyedropper online', 'get color from picture', 'color palette from image', 'image color extractor', 'rgb from image', 'dominant colors'],
  island: 'ImageColorPicker',
  steps: [
    'Drop, choose or paste an image (JPG, PNG, WebP, AVIF, HEIC, GIF or SVG).',
    'Hover to inspect pixels through the magnifier, then click or tap to pick a color.',
    'Copy any value, or export the dominant palette as CSS, Tailwind, JSON or a PNG strip.',
  ],
  faq: [
    { q: 'How accurate is the color I pick?', a: 'You get the exact value of the pixel under the crosshair, read from the full-resolution image even when the preview is shown smaller. The magnifier shows the surrounding pixels so you can land on the right one.' },
    { q: 'How is the dominant palette worked out?', a: 'The image is shrunk to a small copy and its colors are grouped with k-means clustering in the OKLab color space, which measures differences the way the eye sees them. Each swatch is the average of its group, and the percentage is how much of the image it covers. Transparent areas are ignored.' },
    { q: 'What is OKLCH, and why is it shown?', a: 'OKLCH describes a color by lightness, chroma (colorfulness) and hue, in a way that tracks human perception. It is supported in modern CSS, and makes it easy to build lighter or darker shades that still look like the same color.' },
    { q: 'Can I pick a color from outside the image?', a: 'Yes, in browsers that support the EyeDropper API (Chrome, Edge and Opera on desktop). Use "Pick from screen" to grab a color from anywhere on your display. Other browsers simply don\'t show the button.' },
    filePrivacyFaq,
  ],
  related: ['image-converter', 'svg-to-png', 'png-to-svg', 'pixel-art-maker'],
} satisfies Tool;

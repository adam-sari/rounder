import { MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'png-to-svg',
  category: 'image',
  name: 'Image to SVG (vectorize)',
  title: 'PNG to SVG Converter: vectorize logos & line art free',
  h1: 'Image to *SVG*',
  description: 'Convert PNG, JPG and WebP images to SVG vectors. Trace logos, icons, line art and signatures with color, detail and background controls.',
  tagline: 'Trace logos, icons and line art into clean, scalable vector paths.',
  keywords: ['png to svg', 'jpg to svg', 'vectorize image', 'image to vector', 'convert logo to vector', 'raster to vector', 'signature to svg', 'bitmap to svg', 'trace image'],
  island: 'PngToSvg',
  steps: [
    'Drop in a PNG, JPG or WebP. Logos, icons and line art work best.',
    'Pick a preset, then fine-tune colors, detail and smoothing while comparing side by side.',
    'Download the SVG or copy its code.',
  ],
  faq: [
    { q: 'Which images vectorize well?', a: 'Images with clear edges and a handful of flat colors: logos, icons, flat illustrations, line art, scanned drawings and signatures. Photos can be traced too, but they turn into thousands of shapes with a posterized look and a large file.' },
    { q: 'Will the SVG match my image exactly?', a: 'It is an automatic trace, so shapes are approximated with curves. Small text, thin lines and gradients may come out simplified. Fewer colors and more smoothing give cleaner shapes; more detail keeps finer features. For a pixel-perfect logo, use the trace as a starting point in a vector editor.' },
    { q: 'Why was my image traced at a smaller size?', a: 'Tracing time grows quickly with the number of pixels, so images larger than 1,500 px on the long side are scaled down before tracing. The SVG keeps your image\'s original width and height, and as a vector it stays sharp at any size.' },
    { q: 'How do I get a transparent background?', a: 'Turn on "Remove background". It clears the color that touches the edges of the image, such as white paper behind a signature, while keeping the same color inside the design. Areas that are already transparent in a PNG stay transparent.' },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Presets', effect: 'Logo (6 colors), flat illustration (16 colors, light blur), black & white (2 colors, background removed) and detailed (48 colors, finest detail). Each just sets the sliders below.' },
      { name: 'Colors / threshold', effect: 'How many flat colors the image is reduced to before tracing; in black and white mode, the brightness that splits ink from paper.' },
      { name: 'Detail, smoothing and blur', effect: 'Detail keeps smaller shapes; smoothing rounds jagged edges into curves; blur evens out JPG noise before tracing.' },
      { name: 'Remove background', effect: 'Clears the color touching the image\'s edges (white paper, a solid backdrop) while keeping the same color inside the shape. On by default when the page opens for JPG to SVG.' },
    ],
    results: [
      { input: '512×512 PNG logo, 10 KB', setting: 'Logo preset', output: '9.2 KB SVG, 123 paths, 6 colors', note: '0.9 s' },
      { input: '12 MP phone photo, JPG, 4.0 MB', setting: 'Logo preset', output: '2.2 MB SVG, 12,966 paths', note: 'photos turn into thousands of flat patches: keep them as JPG' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'SVG', about: 'Shapes described as paths, so it stays sharp at any size and prints cleanly. Ideal for logos, icons, print and cutting machines.' },
      { name: 'Raster images (PNG, JPG, WebP)', about: 'A grid of pixels. Tracing guesses the shapes behind them, which works for flat artwork and badly for photos.' },
    ],
  },
  related: ['svg-to-png', 'image-converter', 'favicon-generator', 'image-color-picker'],
  flagship: { elsewhere: 'Paid plan or sign-up to download the SVG', here: 'Free SVG download, no sign-up' },
} satisfies Tool;

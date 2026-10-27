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
  related: ['svg-to-png', 'image-converter', 'favicon-generator', 'image-color-picker'],
  flagship: { elsewhere: 'Paid plan or sign-up to download the SVG', here: 'Free SVG download, no sign-up' },
} satisfies Tool;

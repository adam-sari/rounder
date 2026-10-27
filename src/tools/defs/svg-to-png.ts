import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'svg-to-png',
  category: 'image',
  name: 'SVG to PNG',
  title: 'SVG to PNG Converter: high-res, transparent, batch',
  h1: 'SVG to *PNG*',
  description: 'Convert SVG to PNG, JPG or WebP at 1×, 2×, 4× or an exact width. Keep transparency or add a background color. Batch convert, nothing uploaded.',
  tagline: 'Turn SVG files or pasted SVG code into crisp images at any size.',
  keywords: ['svg to png', 'convert svg to png', 'svg to png high resolution', 'svg to png transparent', 'svg to jpg', 'svg to webp', 'export svg as png', 'svg converter'],
  island: 'SvgToPng',
  steps: [
    'Drop in SVG files, or paste SVG code.',
    'Pick a size (1×, 2×, 4× or an exact width or height), a format and a background.',
    'Download each image, or all of them as a zip.',
  ],
  faq: [
    { q: 'What size will my PNG be?', a: '1× uses the width and height set in the SVG, or its viewBox when it has no size of its own. 2× and 4× multiply that, or you can type an exact width or height. The aspect ratio is always kept. Because SVG is a vector format, every size comes out sharp.' },
    { q: 'Why does the text or a picture look wrong in my PNG?', a: 'When a browser draws an SVG as an image, it blocks anything the SVG links to on the web, such as web fonts and external images. Fonts installed on your computer still work. For an exact match, convert text to paths (outlines) in your design app, or embed images as data URLs.' },
    { q: 'Can I keep a transparent background?', a: 'Yes. PNG and WebP keep transparency. JPG has no transparency, so transparent areas are filled with white, or with the background color you pick.' },
    { q: 'Can I convert SVG code I copied from a website or app?', a: 'Yes. Open "paste SVG code", paste it and add it to the list, or simply paste it anywhere on the page. Code copied from a web page often lacks the SVG namespace, which is added for you.' },
    filePrivacyFaq,
  ],
  related: ['png-to-svg', 'image-converter', 'favicon-generator', 'image-resizer'],
  next: ['image-compressor'],
} satisfies Tool;

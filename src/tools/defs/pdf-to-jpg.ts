import { LIMITS, MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default [
  {
    slug: 'pdf-to-jpg',
    category: 'pdf',
    name: 'PDF to JPG',
    title: 'PDF to JPG Converter: every page as an image, free',
    h1: 'PDF to *JPG*',
    description: 'Turn PDF pages into JPG, PNG or WebP images at 72, 150, 300 dpi or any size. Pick pages, download a zip. No upload, no page limits.',
    tagline: 'Save every page, or just the ones you pick, as sharp images.',
    keywords: ['pdf to jpg', 'pdf to jpeg', 'convert pdf to image', 'pdf to image', 'save pdf page as jpg', 'pdf to jpg high quality', 'pdf to jpg 300 dpi', 'extract pdf pages as images'],
    island: 'PdfToImage',
    props: { format: 'jpeg' },
    steps: [
      'Drop in a PDF. Password-protected files ask for their password first.',
      'Convert all pages or pick some, then choose the format and resolution: 150 dpi suits screens, 300 dpi suits print.',
      'Download a single image, or all pages at once as a zip.',
    ],
    faq: [
      { q: 'Which resolution should I choose?', a: '72 dpi matches the page\'s size on screen and makes the smallest files. 150 dpi is sharp on most screens and fine for sharing. 300 dpi is print quality, but the images are four times the pixels of 150 dpi.' },
      { q: 'Why was a page made at a lower dpi than I chose?', a: 'Browsers can only draw images up to a certain size. Very large pages, like posters or architectural drawings, can pass that limit at high dpi, so those pages are drawn at the highest resolution that fits, and the tool tells you when that happens.' },
      { q: 'JPG, PNG or WebP?', a: 'JPG gives small files for scanned pages and photos. PNG is lossless, which keeps text and line art perfectly crisp at the cost of larger files. WebP is usually smaller than JPG at the same quality and opens in every modern browser.' },
      { q: 'Is there a page limit?', a: 'No. Pages are converted one at a time on your device, so a 300-page PDF works too. It just takes longer, and you can cancel and keep the pages already done.' },
      filePrivacyFaq,
    ],
    notes: {
      settings: [
        { name: 'Resolution', effect: '72 dpi is screen size, 150 (default) is sharp on screen, 300 is print quality. "Custom" takes 36 to 1200 dpi; "by width" makes every page the same pixel width.' },
        { name: 'Quality (40–100, default 90)', effect: 'JPG and WebP compression. PNG has no quality setting because it is lossless.' },
        { name: 'Transparent background', effect: 'PNG and WebP only: pages render without the white paper behind them.' },
        { name: 'Pages', effect: 'All pages, or a selection typed as ranges ("1-3, 5, 8-") or clicked on the thumbnails.' },
      ],
      results: [
        { input: '20-page report with photos and charts, 2.3 MB', setting: 'JPG, 150 dpi, quality 90 (defaults)', output: '20 images of 1240×1753, 10 MB zip', note: '2.6 s' },
        { input: '20-page report with photos and charts, 2.3 MB', setting: 'JPG, 300 dpi', output: '26 MB zip', note: 'twice the pixels each way, 8.7 s' },
        { input: '20-page report with photos and charts, 2.3 MB', setting: 'PNG, 150 dpi', output: '12 MB zip', note: '2.5 s' },
      ],
      measured: MEASURED,
      formats: [
        { name: 'JPG', about: 'Small and accepted everywhere; the right pick for pages with photos.' },
        { name: 'PNG', about: 'Lossless, so text edges stay perfectly clean. Bigger for photo-heavy pages.' },
        { name: 'WebP', about: 'Smaller than JPG at a similar look, if the place you upload to accepts it.' },
      ],
      limits: [
        { where: 'Browser canvas', limit: 'pages are drawn at most 16,384 px on a side and 120 megapixels (16.7 megapixels on iPhone and iPad); a bigger request is scaled down and marked' },
        LIMITS.gmail,
      ],
    },
    related: ['jpg-to-pdf', 'extract-images-from-pdf', 'split-pdf', 'compress-pdf'],
    next: ['image-compressor', 'image-resizer'],
    flagship: { elsewhere: 'Daily task limits and upload size caps', here: 'Any number of pages, up to 1200 dpi' },
  },
  {
    slug: 'pdf-to-png',
    category: 'pdf',
    name: 'PDF to PNG',
    title: 'PDF to PNG Converter: crisp, lossless page images, free',
    h1: 'PDF to *PNG*',
    description: 'Convert PDF pages to lossless PNG images at any dpi, with an optional transparent background. Pick pages, download a zip. Nothing is uploaded.',
    tagline: 'Lossless PNG images of your PDF pages, with crisp text and lines.',
    keywords: ['pdf to png', 'convert pdf to png', 'pdf to png high resolution', 'pdf page to png', 'pdf to png transparent', 'pdf to png converter', 'save pdf as png'],
    island: 'PdfToImage',
    props: { format: 'png' },
    variantOf: 'pdf-to-jpg',
    steps: [
      'Drop in a PDF. Password-protected files ask for their password first.',
      'Convert all pages or pick some, then set the resolution. Turn on a transparent background if you need one.',
      'Download a single PNG, or all pages at once as a zip.',
    ],
    faq: [
      { q: 'PDF to PNG or PDF to JPG?', a: 'PNG is lossless, so text, diagrams and line art stay perfectly sharp with no smudging. JPG files are much smaller and fine for scanned pages and photos.' },
      { q: 'Can the background be transparent?', a: 'Yes. Turn on "Transparent background" and anything the page doesn\'t paint stays see-through. Some PDFs paint a white rectangle behind everything, and that stays white.' },
      { q: 'Why are the PNG files large?', a: 'PNG stores every pixel exactly. At 300 dpi a letter-size page is about 2550 × 3300 pixels, so files of a few megabytes are normal. At 150 dpi each image has a quarter as many pixels.' },
      filePrivacyFaq,
    ],
    related: ['jpg-to-pdf', 'extract-images-from-pdf', 'split-pdf'],
  },
] satisfies Tool[];

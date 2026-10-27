import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'extract-images-from-pdf',
  category: 'pdf',
  name: 'Extract images from PDF',
  title: 'Extract Images from PDF: save every photo at full quality',
  h1: 'Extract *images* from PDF',
  description: 'Pull every photo and graphic out of a PDF at its original quality. JPEGs come out untouched, duplicates are merged. Free, no upload, no limits.',
  tagline: 'Save the photos inside a PDF at their original quality, one by one or as a zip.',
  keywords: ['extract images from pdf', 'pdf image extractor', 'save images from pdf', 'get pictures from pdf', 'pdf to images', 'export images from pdf', 'download images from pdf', 'pdf photo extractor'],
  island: 'PdfExtractImages',
  steps: [
    'Drop in a PDF. Password-protected files can be unlocked right here.',
    'Every embedded image is found, including ones inside stamps and graphics, with repeats merged into one.',
    'Pick the ones you want and download them one at a time or together as a zip.',
  ],
  faq: [
    { q: 'Are the images recompressed?', a: 'No. JPEG photos are saved byte for byte exactly as they are stored in the PDF, so there is no quality loss at all. Other images are rebuilt as lossless PNG files, keeping transparency where the PDF has it. A JPEG can\'t hold transparency, so if the PDF pairs one with a see-through mask, the JPEG is saved without it and labeled.' },
    { q: 'Why is an image smaller or cropped differently than on the page?', a: 'You get the image as it is stored in the file, at its own resolution. The PDF may scale, crop or rotate it when drawing the page. To capture a page exactly as it looks, use PDF to JPG instead.' },
    { q: 'Why are some things missing?', a: 'Only real images can be extracted. Charts, logos and diagrams drawn as vector shapes, and text, are not stored as pictures. Tiny images such as icons and spacers are hidden by default; untick the option to see them.' },
    { q: 'Which image types are supported?', a: 'JPEG (kept as is, CMYK ones included), and lossless images in color, grayscale or a color palette. JPEG 2000, JBIG2 and fax-compressed images, and lossless CMYK ones, are decoded with the built-in PDF renderer and saved as PNG.' },
    filePrivacyFaq,
  ],
  related: ['pdf-to-jpg', 'pdf-to-text', 'image-compressor', 'compress-pdf'],
} satisfies Tool;

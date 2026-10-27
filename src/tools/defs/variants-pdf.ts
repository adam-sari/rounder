import { filePrivacyFaq, type Tool } from '../types';

export default [
  {
    slug: 'png-to-pdf',
    category: 'pdf',
    name: 'PNG to PDF',
    title: 'PNG to PDF Converter: screenshots & images into one PDF',
    h1: 'PNG to *PDF*',
    description: 'Convert PNG screenshots, diagrams and scans to PDF without losing quality. Pages match each image, or pick Letter or A4. Combine many PNGs, no upload.',
    tagline: 'Screenshots and diagrams into a PDF, pixel for pixel.',
    keywords: ['png to pdf', 'convert png to pdf', 'png to pdf converter', 'multiple png to pdf', 'screenshot to pdf', 'combine png into pdf', 'png to pdf without losing quality'],
    island: 'ImagesToPdf',
    props: { size: 'fit' },
    variantOf: 'jpg-to-pdf',
    steps: [
      'Drop in your PNG files, as many as you like. JPGs and other images can go in the same PDF.',
      'Drag them into order. Each page starts shaped like its image; switch to Letter or A4 if you will print it.',
      'Create the PDF and download it, or make one PDF per image as a zip.',
    ],
    faq: [
      { q: 'Will my PNGs stay sharp?', a: 'Yes. PNGs go into the PDF losslessly, with every pixel kept as it is, so text in screenshots and lines in diagrams stay exactly as crisp. Only "Compress images", or a size limit the originals don\'t fit, changes them: they are then re-saved as JPGs, which suits photos better than screenshots.' },
      { q: 'Why is every page a different size?', a: 'This page starts with "Fit image" page size, so each page takes the shape of its PNG with no white borders, and screenshots keep their on-screen size (96 pixels per inch). Pick Letter or A4 to put every image on a standard page instead, which is better for printing.' },
      { q: 'What happens to transparent areas?', a: 'The white page shows through them, as it would on paper. With "Compress images" on, see-through areas are filled with white, because JPG has no transparency.' },
      filePrivacyFaq,
    ],
    related: ['pdf-to-png', 'merge-pdf', 'compress-pdf', 'screenshot-beautifier'],
  },
  {
    slug: 'heic-to-pdf',
    category: 'pdf',
    name: 'HEIC to PDF',
    title: 'HEIC to PDF Converter: iPhone photos into one PDF, free',
    h1: 'HEIC to *PDF*',
    description: 'Turn iPhone HEIC photos into a PDF on your own device. Combine several photos, put them in order and pick Letter or A4. Nothing is uploaded.',
    tagline: 'iPhone photos and document snaps, combined into one PDF.',
    keywords: ['heic to pdf', 'convert heic to pdf', 'iphone photo to pdf', 'heic to pdf converter', 'multiple heic to pdf', 'heif to pdf'],
    island: 'ImagesToPdf',
    props: { compress: true },
    variantOf: 'jpg-to-pdf',
    steps: [
      'Drop in your HEIC photos, straight from an iPhone or iPad or downloaded from iCloud Photos.',
      'Drag them into order and pick the page size and margins. "Compress images" is already on to keep the PDF small.',
      'Create the PDF and download it, or make one PDF per photo as a zip.',
    ],
    faq: [
      { q: 'Why turn HEIC photos into a PDF?', a: 'HEIC is the format iPhones save photos in with the default "High Efficiency" setting. It is compact, but many Windows PCs, websites and upload forms for jobs, schools and government services don\'t accept it. A PDF opens everywhere and keeps several photos, like the pages of a document, together in one file.' },
      { q: 'Why is "Compress images" already on?', a: 'A PDF can\'t hold HEIC, so every photo has to be re-saved anyway. With Compress images on, each one is saved as a JPG at quality 75 and scaled down to 2500 pixels on its long side, still sharp enough to print a full page. Turn it off for full-size photos at high quality, which makes a much larger PDF.' },
      { q: 'Do the photos come out the right way up?', a: 'Yes. Each photo\'s rotation is read and applied, so portrait shots stay portrait on the page. The thumbnails show each page as it will look before you create the PDF.' },
      filePrivacyFaq,
    ],
    related: ['heic-to-jpg', 'merge-pdf', 'compress-pdf', 'image-compressor'],
  },
] satisfies Tool[];

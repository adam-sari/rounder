import { filePrivacyFaq, type Tool } from '../types';

// Images to PDF with a size limit (ImagesToPdf { targetKb }): photos of documents into one PDF that fits a form.

export default {
  slug: 'jpg-to-pdf-under-200kb',
  category: 'pdf',
  name: 'JPG to PDF under 200 KB',
  title: 'JPG to PDF Under 200 KB: photos into one small PDF',
  h1: 'JPG to PDF *under 200 KB*',
  description: 'Turn photos of documents into one PDF under 200 KB for an upload form. Quality drops only as far as needed, and the result is checked. No upload.',
  tagline: 'Phone snaps of a document, into one PDF small enough to upload.',
  keywords: ['jpg to pdf under 200kb', 'jpg to pdf 200kb', 'image to pdf under 200kb', 'photo to pdf small size', 'jpg to pdf less than 200kb', 'convert jpg to pdf 100kb'],
  island: 'ImagesToPdf',
  props: { targetKb: 200 },
  variantOf: 'jpg-to-pdf',
  steps: [
    'Drop in the photos or scans, one per page, and drag them into order. The size limit is already on at 200 KB; change it if your form allows more or less.',
    'Create the PDF. If the first build is too big, it tries again with lower JPG quality, then smaller photos, until the PDF fits.',
    'Check "Result: … ✓ fits under 200 KB" and download.',
  ],
  faq: [
    {
      q: 'How many photos fit in 200 KB?',
      a: 'As a rough guide, two to four document photos, each scaled to a size that still reads well on screen. More pages need smaller or lower-quality photos, and the result tells you the quality and pixel size it ended up with, so you can check legibility before you upload.',
    },
    {
      q: 'Why not just compress the PDF afterwards?',
      a: 'You can (see Compress PDF to 200 KB), but building it small in the first place saves a step and avoids compressing the photos twice.',
    },
    {
      q: 'Does the limit apply to "One PDF per image"?',
      a: 'No, the limit is for a single combined PDF. To get several small PDFs, make them one at a time, or make one PDF and use Split PDF.',
    },
    filePrivacyFaq,
  ],
  related: ['jpg-to-pdf', 'compress-pdf', 'compress-image-to-100kb', 'merge-pdf'],
} satisfies Tool;

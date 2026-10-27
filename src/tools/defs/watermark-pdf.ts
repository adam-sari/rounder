import { MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'watermark-pdf',
  category: 'pdf',
  name: 'Watermark PDF',
  title: 'Watermark PDF: add text or logo watermarks free, no upload',
  h1: 'Watermark *PDF*',
  description: 'Add a text or image watermark to PDF pages: diagonal, tiled or in a corner, over or under the content. Live preview, batches welcome, nothing uploaded.',
  tagline: 'Stamp CONFIDENTIAL, DRAFT or your logo across every page.',
  keywords: ['add watermark to pdf', 'pdf watermark', 'watermark pdf online', 'confidential watermark pdf', 'draft watermark pdf', 'add logo to pdf', 'stamp pdf', 'diagonal watermark pdf'],
  island: 'WatermarkPdf',
  steps: [
    'Drop in one or more PDFs. If a file is password-protected, you will be asked for its password.',
    'Type your text or choose a PNG or JPG, then set the size, opacity, angle and position while the preview updates.',
    'Click Add watermark, then download each PDF or all of them as a zip.',
  ],
  faq: [
    {
      q: 'What is the difference between over and under content?',
      a: 'Over puts the watermark on top of everything, so it is always visible. Under draws it behind the page\'s own text and graphics, so text stays crisp and readable on top. Under is hidden by photos and solid backgrounds, so it won\'t show on scanned pages.',
    },
    {
      q: 'Can someone remove the watermark?',
      a: 'The watermark is drawn into the page content, not added as a comment or annotation, so it can\'t simply be deleted from a list. Someone with PDF editing software and enough effort can still remove it, as with any PDF watermark.',
    },
    {
      q: 'Does it work on rotated, landscape or cropped pages?',
      a: 'Yes. The watermark is placed on the page as you see it, so it stays centered and upright on every page. Diagonal runs from corner to corner on portrait and landscape pages alike.',
    },
    {
      q: 'Will the file get much bigger?',
      a: 'Usually only slightly. The text or image is stored once and reused on every page, so even a tiled watermark on a long document adds little beyond the size of your image.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Text or image', effect: 'Text (default "CONFIDENTIAL") in sans, serif or mono, optionally bold, at a size in points; or a logo image scaled as a share of the page.' },
      { name: 'Opacity (default 25%)', effect: 'How see-through the mark is. Around 15–30% stays readable without hiding the page.' },
      { name: 'Rotation', effect: 'Diagonal runs corner to corner on every page whatever its shape; Level is horizontal; Custom takes any angle.' },
      { name: 'Position', effect: 'One of nine spots with a margin, or tiled to repeat across the whole page.' },
      { name: 'Layer', effect: 'Over content sits on top of everything; Under content goes beneath the text and images, so it shows only through empty areas.' },
      { name: 'Pages', effect: 'Every page, or only the ranges you type.' },
    ],
    results: [{ input: '20-page report with photos, 2.3 MB', setting: 'Text "CONFIDENTIAL", defaults', output: '2.2 MB', note: '0.3 s; the mark is stored once and placed on every page by reference' }],
    measured: MEASURED,
    formats: [{ name: 'What is added', about: 'Real PDF text or one embedded image, drawn into each page\'s content. The original pages aren\'t rasterized, so their text stays selectable.' }],
  },
  related: ['add-page-numbers-to-pdf', 'protect-pdf', 'watermark-image', 'merge-pdf'],
  next: ['protect-pdf', 'compress-pdf'],
  flagship: { elsewhere: 'Daily task limits and file size caps', here: 'Unlimited PDFs, no size cap' },
} satisfies Tool;

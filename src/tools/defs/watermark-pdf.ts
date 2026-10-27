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
  related: ['add-page-numbers-to-pdf', 'protect-pdf', 'watermark-image', 'merge-pdf'],
  flagship: { elsewhere: 'Daily task limits and file size caps', here: 'Unlimited PDFs, no size cap' },
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'pdf-to-powerpoint',
  category: 'pdf',
  name: 'PDF to PowerPoint',
  title: 'PDF to PowerPoint Converter: PDF to PPTX slides, free',
  h1: 'PDF to *PowerPoint*',
  description: 'Turn every PDF page into a PowerPoint slide (.pptx) that looks exactly like the page, with its text in the speaker notes. Free, no sign-up, nothing uploaded.',
  tagline: 'One slide per PDF page, pixel for pixel, ready to present or add to.',
  keywords: ['pdf to powerpoint', 'pdf to ppt', 'pdf to pptx', 'convert pdf to powerpoint', 'pdf to slides', 'pdf to presentation', 'pdf to ppt converter'],
  island: 'PdfToOffice',
  props: { to: 'powerpoint' },
  steps: [
    'Drop in a PDF. Password-protected files ask for their password first.',
    'Pick how sharp the slides should be, and whether each page’s text goes into the speaker notes.',
    'Download the .pptx. Each slide has the page’s shape, so nothing is stretched or cropped.',
  ],
  faq: [
    {
      q: 'Can I edit the text on the slides?',
      a: 'Not directly: each slide shows the page as a picture, which is what keeps it looking exactly like the PDF, fonts and layout included. The page’s text is copied into the speaker notes, so you can copy it from there, search the deck, or type over the slide with your own text boxes. For editable text, convert the PDF to Word instead.',
    },
    {
      q: 'What size are the slides?',
      a: 'The slides take the first page’s shape: a landscape PDF gives wide slides, a portrait one gives tall slides. Pages of another shape are centered on a white slide rather than stretched.',
    },
    {
      q: 'Which sharpness should I pick?',
      a: 'Sharp suits laptops and projectors. Extra sharp keeps small print readable on big screens or when zooming in, at about twice the file size. Standard makes the smallest file for email.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Slide sharpness', effect: 'How finely each page is drawn: about 110, 150 or 220 dots per inch. Sharper means a bigger file.' },
      { name: 'Page text in speaker notes', effect: 'Copies each page’s text into its slide’s notes, so the deck stays searchable.' },
    ],
    results: [
      { input: '2-page report (16 KB) with a chart', setting: 'Sharp', output: '2 slides, 429 KB, in 0.4 s' },
      { input: '40-page text report (51 KB)', setting: 'Sharp', output: '40 slides, 12.5 MB, in 3.5 s' },
    ],
    measured: { date: '2026-10-27', device: 'Chromium 156 on a Windows 11 desktop (Intel Core i7-12700F)' },
  },
  related: ['powerpoint-to-pdf', 'pdf-to-jpg', 'pdf-to-word', 'compress-pdf'],
  next: ['powerpoint-to-pdf'],
  flagship: { elsewhere: 'Uploads your PDF to someone’s server', here: 'Converted on your device, never uploaded' },
} satisfies Tool;

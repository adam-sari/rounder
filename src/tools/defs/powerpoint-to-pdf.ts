import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'powerpoint-to-pdf',
  category: 'pdf',
  name: 'PowerPoint to PDF',
  title: 'PowerPoint to PDF Converter: PPTX to PDF, free & private',
  h1: 'PowerPoint to *PDF*',
  description: 'Convert PowerPoint presentations (.pptx) to PDF, one slide per page, with selectable text, shapes, pictures, tables and charts. Free and never uploaded.',
  tagline: 'Turn a .pptx deck into a PDF handout in your browser.',
  keywords: ['powerpoint to pdf', 'ppt to pdf', 'pptx to pdf', 'convert powerpoint to pdf', 'slides to pdf', 'presentation to pdf', 'save powerpoint as pdf'],
  island: 'OfficeToPdf',
  props: { from: 'powerpoint' },
  steps: [
    'Drop in a PowerPoint presentation (.pptx). The first time, the PowerPoint reader loads once, about 1.4 MB.',
    'Each slide is drawn by your browser at its own size, with its text, shapes, pictures, tables and charts.',
    'Check the slide previews, then download the PDF, one slide per page.',
  ],
  faq: [
    {
      q: 'Will the slides look the same as in PowerPoint?',
      a: 'Close, for most decks. Text, theme colors and fonts (matched to free equivalents), shapes, pictures, tables and common charts come across. Animations and transitions can’t be part of a PDF, so each slide shows its final state. SmartArt, 3D effects, videos and unusual fonts may look different or be missing, so check the preview before you share it.',
    },
    {
      q: 'Is the text selectable?',
      a: 'Yes. Slide text is real text in the PDF, so you can search and copy it. Shapes, charts and drawings are added as sharp pictures. Characters the embedded fonts lack, such as Chinese, Arabic or emoji, become small pictures too, and the tool tells you when that happens.',
    },
    {
      q: 'Are hidden slides and speaker notes included?',
      a: 'Hidden slides are left out, as when you present. Speaker notes are not added to the PDF.',
    },
    {
      q: 'Can I convert an old .ppt file?',
      a: 'Only .pptx files can be read here. Open an older .ppt in PowerPoint, Google Slides or LibreOffice and save it as .pptx first. A password-protected presentation needs its password removed first.',
    },
    filePrivacyFaq,
  ],
  notes: {
    results: [{ input: '5-slide deck (.pptx, 112 KB): bullets, table, bar chart, shapes, picture', setting: 'Default', output: '5-page PDF, 81 KB, in 0.7 s' }],
    measured: { date: '2026-10-27', device: 'Chromium 156 on a Windows 11 desktop (Intel Core i7-12700F)' },
  },
  related: ['pdf-to-powerpoint', 'word-to-pdf', 'excel-to-pdf', 'compress-pdf', 'merge-pdf'],
  next: ['compress-pdf', 'merge-pdf'],
  flagship: { elsewhere: 'Your presentation is uploaded to someone’s server', here: 'Converted on your device, never uploaded' },
} satisfies Tool;

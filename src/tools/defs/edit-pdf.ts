import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'edit-pdf',
  category: 'pdf',
  name: 'Edit PDF',
  title: 'Edit PDF Online Free: add text, images, whiteout & shapes',
  h1: 'PDF *editor*',
  description: 'Add text, images, signatures, highlights, shapes, arrows and whiteout to any PDF in your browser. Free, no watermark, no sign-up, nothing uploaded.',
  tagline: 'Write, draw, highlight and cover things up on any PDF, without uploading it.',
  keywords: ['edit pdf', 'pdf editor online free', 'add text to pdf', 'annotate pdf', 'whiteout pdf', 'highlight pdf', 'add image to pdf', 'draw on pdf', 'pdf annotator'],
  island: 'EditPdf',
  steps: [
    'Drop in your PDF.',
    'Pick a tool and click or drag on a page: text, images, whiteout, highlights, boxes, arrows or freehand drawing.',
    'Move, resize or delete anything you added, then download the edited PDF.',
  ],
  faq: [
    {
      q: 'Can I change the text that is already in the PDF?',
      a: "Not directly: this editor adds new content on top of the page. To replace a word or a number, cover it with a whiteout box and type the new text over it. The original text is still in the file underneath, so to remove sensitive information for good, use Redact PDF instead.",
    },
    {
      q: 'Will my PDF lose quality?',
      a: 'No. The original pages are kept exactly as they were, including text you can select and search. What you add is drawn as real PDF text and shapes, so it stays sharp at any zoom. Only pictures you add are images.',
    },
    {
      q: 'Which fonts can I use?',
      a: "Sans, serif and mono (Helvetica, Times and Courier, which every PDF reader has), in regular or bold. Text with letters those fonts lack, such as Greek, Cyrillic or Polish, uses a built-in Unicode sans font instead. Chinese, Japanese, Korean, Arabic and emoji aren't supported yet.",
    },
    {
      q: 'Is there a watermark or a page limit?',
      a: "No watermark, no page limit and no daily limit. Pages are drawn as you scroll, so long documents open quickly; very large files depend on your device's memory.",
    },
    filePrivacyFaq,
  ],
  related: ['sign-pdf', 'redact-pdf', 'fill-pdf-form', 'watermark-pdf'],
  flagship: { elsewhere: 'Editing behind a subscription or a daily task limit', here: 'Every editing tool, free and unlimited' },
} satisfies Tool;

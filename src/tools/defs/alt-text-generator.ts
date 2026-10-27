import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'alt-text-generator',
  category: 'ai',
  name: 'Image caption & alt text generator',
  title: 'Alt Text Generator: free AI image captions, private',
  h1: 'Alt text *generator*',
  description: 'Free AI alt text and image caption generator. Batch images, edit each caption, copy it or export CSV. Runs on your device: nothing uploaded, no sign-up.',
  tagline: 'AI drafts alt text and captions for your images, right in your browser.',
  keywords: ['image caption generator', 'describe image ai', 'image description generator', 'alt tag generator', 'accessibility alt text', 'bulk alt text', 'seo alt text', 'caption my photo', 'florence-2'],
  island: 'AltTextGenerator',
  steps: [
    'Click "Download model & start" once (about 280 MB), then drop in one image or a whole batch.',
    'Pick what to write: short alt text, a detailed caption, a long description or the text in the picture.',
    'Edit each draft so it fits your page, then copy it, copy an <img> tag or download everything as CSV.',
  ],
  faq: [
    {
      q: 'Which AI model writes the captions, and what is its license?',
      a: 'Florence-2 base (fine-tuned) by Microsoft, released under the MIT license, in the browser version published by the ONNX Community. It runs on your device: on your graphics card through WebGPU (about a second per picture) or, more slowly, on your processor (several seconds per picture, longer for long descriptions). The first run downloads about 280 MB (360 MB for the graphics-card version) once; after that it loads from your browser.',
    },
    {
      q: 'Is AI alt text good enough to publish?',
      a: "Treat it as a first draft. The model describes what it sees, in English, and can get counts, colors or text wrong. It can't know who people are or why the picture is on your page, and that is what good alt text is about. Read each one and edit it in place before you copy it.",
    },
    {
      q: 'How long should alt text be?',
      a: 'Usually one sentence of up to about 125 characters, starting with the subject rather than "image of". The alt text mode keeps to that and shows a counter. For charts, art or busy scenes, use the detailed or long description and put it in a caption or the text next to the image.',
    },
    {
      q: 'Can I caption a whole folder of images?',
      a: 'Yes. Drop in as many as you like and they are captioned one after another, with no daily limit. Download a CSV with filename and alt text columns for a spreadsheet or a bulk import into your CMS or shop.',
    },
    filePrivacyFaq,
  ],
  related: ['image-to-text', 'background-remover', 'image-compressor', 'image-upscaler'],
  flagship: { elsewhere: 'Credits per image, bulk behind a paid plan', here: 'Unlimited images, free, on your device' },
} satisfies Tool;

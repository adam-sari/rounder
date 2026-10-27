import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'text-summarizer',
  category: 'ai',
  name: 'Text summarizer',
  title: 'Text Summarizer: free AI summaries that run on your device',
  h1: 'Text *summarizer*',
  description: 'Summarize articles, reports, essays and PDFs with AI that runs in your browser. Paragraph, key points, TL;DR or headline. No word limit, no sign-up.',
  tagline: 'Long text in, the gist out: paragraph, key points, TL;DR or headline.',
  keywords: ['summarizer', 'summarize text', 'ai summarizer', 'article summarizer', 'summary generator', 'tldr generator', 'summarize pdf', 'key points generator', 'text shortener'],
  island: 'TextSummarizer',
  steps: [
    'Paste your text, or open a .txt, .md or .pdf file. Nothing is uploaded.',
    'Pick a format (paragraph, key points, TL;DR or headline) and a length.',
    'Press Summarize and watch it being written, then copy or download it.',
  ],
  faq: [
    {
      q: 'Which AI model does this use?',
      a: "If your browser has Chrome's built-in AI (Chrome 138 or later on a computer), we use its Summarizer, powered by Google's Gemini Nano. Chrome downloads that model once and shares it between sites. Otherwise we download Qwen3.5 0.8B by the Qwen team at Alibaba Cloud, which is released under the Apache-2.0 license. It's about 490 MB, downloads once, and runs on your graphics card through WebGPU. You can switch between the two.",
    },
    {
      q: 'Is there a word limit?',
      a: "No. Long texts are split into parts. Each part is condensed into notes, and then the notes are summarized in the format you picked. Very long documents take longer, and the progress shows which part is being read. The only limit is your device's speed.",
    },
    {
      q: 'Can I trust the summary?',
      a: "Use it as a quick overview, not as the final word. AI summaries can leave out points or misread them. Small on-device models do this more often than large cloud models. Check names, numbers and quotes against the original before you rely on them.",
    },
    {
      q: 'Does it work with PDFs and other languages?',
      a: "Yes for PDFs that contain text: we read it on your device. Scanned PDFs need OCR first. Chrome's built-in AI handles English, Spanish, Japanese, German and French. Qwen understands many more languages and answers in the language of your text.",
    },
    privacyFaq,
  ],
  related: ['paraphrasing-tool', 'grammar-checker', 'pdf-to-text', 'word-counter'],
  flagship: { elsewhere: 'Free plans stop at about 1,000 words', here: 'Any length, no sign-up, on your device' },
} satisfies Tool;

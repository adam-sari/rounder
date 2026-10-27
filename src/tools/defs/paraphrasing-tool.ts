import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'paraphrasing-tool',
  category: 'ai',
  name: 'Paraphrasing tool',
  title: 'Paraphrasing Tool: free AI rewriter, 7 modes, no word limit',
  h1: 'Paraphrasing *tool*',
  description: 'Rewrite text in 7 modes: standard, fluent, formal, casual, shorter, longer, simpler. See every change and swap sentences. AI runs on your device.',
  tagline: 'Say it another way: seven modes, highlighted changes, a choice of sentences.',
  keywords: ['paraphrasing tool', 'paraphraser', 'rewrite text', 'reword sentences', 'sentence rewriter', 'ai rewriter', 'rephrase', 'quillbot alternative', 'make text formal'],
  island: 'Paraphraser',
  steps: [
    'Paste your text or open a .txt, .md or .pdf file, then pick a mode.',
    'Press Paraphrase. The rewrite streams in next to your original, with changed words underlined.',
    'Click any sentence for three other versions, swap in the one you like, then copy the result.',
  ],
  faq: [
    {
      q: 'Which AI model does this use?',
      a: "If your browser has Chrome's built-in AI (the Prompt API, in recent Chrome on a computer), we use it. It's powered by Google's Gemini Nano, which Chrome downloads once. Otherwise we download Qwen3.5 0.8B by the Qwen team at Alibaba Cloud, which is released under the Apache-2.0 license. It's about 490 MB, downloads once, and runs on your graphics card through WebGPU.",
    },
    {
      q: 'What do the modes do?',
      a: "Standard rewords the text at about the same length. Fluent smooths awkward phrasing. Formal and Casual change the tone. Shorter cuts the text to about half its length. Longer explains more without adding facts. Simpler uses plain words and short sentences. Press Rewrite again for a different version: the model words things a little differently each time.",
    },
    {
      q: 'Is the paraphrased text always right?',
      a: "No. This is AI, and small models sometimes shift the meaning, drop a detail or get a fact wrong. Read the rewrite before you use it. The underlined words show what changed. Also check your school's or publisher's rules on AI-assisted writing.",
    },
    {
      q: 'Is there a word or mode limit?',
      a: "No. All seven modes are free and there is no word limit. Long texts are rewritten a few paragraphs at a time so the model stays accurate. Nothing is counted, because nothing reaches us.",
    },
    privacyFaq,
  ],
  related: ['grammar-checker', 'text-summarizer', 'word-counter', 'diff-checker'],
  flagship: { elsewhere: '125 words and 2 modes on free plans', here: 'All 7 modes, no word limit' },
} satisfies Tool;

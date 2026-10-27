import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'grammar-checker',
  category: 'ai',
  name: 'Grammar checker',
  title: 'Grammar Checker: free AI proofreading, private, no sign-up',
  h1: 'Grammar *checker*',
  description: 'Check grammar, spelling and punctuation with AI that runs in your browser, plus instant quick checks. Accept or reject each fix. Nothing is uploaded.',
  tagline: 'Instant quick checks, then an AI proofread you review change by change.',
  keywords: ['grammar checker', 'spell checker', 'proofreading tool', 'punctuation checker', 'check my grammar', 'grammarly alternative', 'sentence checker', 'free grammar check', 'ai proofreader'],
  island: 'GrammarChecker',
  steps: [
    'Paste or type your text. Quick checks for repeated words, a/an, spacing and common mix-ups appear at once, no AI needed.',
    'Press Proofread with AI. It fixes spelling, grammar and punctuation on your device.',
    'Review each change in the text, accept or reject it, then copy the corrected text or put it back in the box.',
  ],
  faq: [
    {
      q: 'Which AI model does this use?',
      a: "If your browser has Chrome's built-in AI, we use it: the Proofreader API when Chrome offers it, otherwise its Prompt API. Both are powered by Google's Gemini Nano, which Chrome downloads once. Otherwise we download Qwen3.5 0.8B by the Qwen team at Alibaba Cloud, which is released under the Apache-2.0 license. It's about 490 MB, downloads once, and runs on your graphics card through WebGPU.",
    },
    {
      q: 'What do the quick checks catch?',
      a: 'Repeated words ("the the"), extra spaces, spaces before commas or periods, missing spaces after them, "a" vs "an", a lowercase "i", sentences that start in lowercase, mix-ups like "could of", "more then" and "your welcome", and about a hundred common misspellings. They follow fixed rules, so they are instant and work without AI. They only look for these patterns, though, and the English rules switch off for other languages.',
    },
    {
      q: 'Will the AI change my writing style?',
      a: "It's told to fix mistakes only and leave correct wording alone. Small models still sometimes rephrase things. That's why every change is shown in the text and you accept or reject each one. AI can also miss mistakes or suggest wrong ones, so the final call is always yours.",
    },
    {
      q: 'Which languages does it check?',
      a: "The AI proofread works best in English. Chrome's built-in AI also handles Spanish, Japanese, German and French, and Qwen understands many more languages. The quick checks for spacing and repeated words work in any language. The a/an, mix-up and spelling checks are English only.",
    },
    privacyFaq,
  ],
  related: ['paraphrasing-tool', 'text-summarizer', 'word-counter', 'translator'],
  flagship: { elsewhere: 'Full proofreading behind a subscription', here: 'AI proofreading free, on your device' },
} satisfies Tool;

import { LANGUAGES, opusCoverage } from '../lib/translator/languages';
import { privacyFaq, type Tool } from '../types';

const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join(''));
const open = opusCoverage();

export default {
  slug: 'translator',
  category: 'ai',
  name: 'Private translator (runs on your device)',
  title: 'Private Translator: translate text & documents on your device',
  h1: 'Private *translator*',
  description: `Translate text and .txt or Markdown files with AI that runs in your browser, up to ${LANGUAGES.length} languages. Nothing is uploaded. Free, no sign-up.`,
  tagline: 'Translate text and documents with AI that runs on your device, not on a server.',
  keywords: ['translate', 'online translator', 'translate text', 'document translator', 'translate markdown', 'private translator', 'offline translator', 'google translate alternative', 'deepl alternative', 'language detector'],
  island: 'Translator',
  steps: [
    'Type or paste your text, or open a .txt or .md file. The language is detected for you.',
    'Pick the language to translate into and press Translate. If your browser has no translator built in, a translation model downloads once first (110–140 MB per language direction).',
    'Copy the translation or download it as a file. Markdown headings, lists, links and code stay as they were.',
  ],
  faq: [
    {
      q: 'How does it translate without sending my text to a server?',
      a: 'It uses AI models that run on your device. Chrome and Edge on a computer have a translator built in, and we use it when it supports your language pair. In other browsers, an open translation model downloads once (110–140 MB per language direction), stays in your browser, and runs on your processor in the background. After that it even works offline. It is machine translation, so it can make mistakes: check anything important before you rely on it.',
    },
    {
      q: 'Which AI model is used, and what is its license?',
      a: "In Chrome and Edge, it's the browser's own on-device translation model, provided and updated by the browser. Everywhere else it's OPUS-MT by Helsinki-NLP at the University of Helsinki (Jörg Tiedemann et al.), in the quantized ONNX version by Xenova. One model covers one direction. Most are licensed Apache 2.0; English → German, Russian → English and Chinese → English are CC BY 4.0. The model and its license are credited under every translation.",
    },
    {
      q: 'Which languages can I translate?',
      a: `With the built-in translator in Chrome or Edge on a computer: ${LANGUAGES.length} languages, including Chinese, Japanese, Korean, Arabic, Hindi and most European languages. In other browsers the open models translate between English and ${list(open.both)}${open.intoEnglish.length ? `, and from ${list(open.intoEnglish)} into English` : ''}. Pairs without English, such as Spanish to French, go through English with two models.`,
    },
    {
      q: 'Can I translate a whole document?',
      a: "Yes. Open a .txt or Markdown file, or paste a long text. There's no character limit. It's split into sentences and translated piece by piece with a progress bar. In Markdown, headings, lists, tables, links, code blocks and front matter keep their structure; only the prose is translated. For Word or PDF files, copy the text out first (our PDF to text tool can help).",
    },
    privacyFaq,
  ],
  related: ['text-summarizer', 'paraphrasing-tool', 'subtitle-generator', 'image-to-text'],
  flagship: { elsewhere: 'Character limits, your text sent to their servers', here: 'No limits, translated on your device' },
} satisfies Tool;

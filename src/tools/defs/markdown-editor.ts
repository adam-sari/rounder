import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'markdown-editor',
  category: 'text',
  name: 'Markdown editor',
  title: 'Markdown Editor Online with Live Preview & HTML Export',
  h1: 'Markdown *editor*',
  description: 'Write Markdown with a live side-by-side preview. Tables, task lists, autosaved drafts, and export to .md or a styled HTML page. Nothing is uploaded.',
  tagline: 'Write on one side, see it formatted on the other, and export clean HTML.',
  keywords: ['markdown editor online', 'markdown preview', 'md editor', 'markdown to html', 'live markdown editor', 'github markdown editor', 'markdown viewer', 'readme editor'],
  island: 'MarkdownEditor',
  steps: [
    'Type or paste Markdown, or open a .md file. The preview updates as you write.',
    'Use the toolbar or Ctrl+B, Ctrl+I and Ctrl+K for bold, italic and links.',
    'Download it as a .md file or a styled .html page, or copy the HTML.',
  ],
  faq: [
    { q: 'Which Markdown does it support?', a: 'GitHub Flavored Markdown: headings, lists, links, images, code blocks, tables, task lists, strikethrough and automatic links. Raw HTML works too, though scripts, style sheets and forms are removed from the preview for safety.' },
    { q: 'Where is my draft saved?', a: 'In your browser\'s local storage on this device, a moment after you stop typing. It isn\'t synced anywhere, and clearing your browser data removes it, so download a copy of anything you want to keep.' },
    { q: 'What does the HTML download look like?', a: 'A single self-contained page with clean, readable styling built in. It works offline, follows your system\'s light or dark mode and prints neatly. "Copy HTML" gives you just the body markup to paste into a CMS or email.' },
    { q: 'Can I turn it into a PDF?', a: 'Yes. Download the .md file and open it in our Markdown to PDF tool, or open the downloaded .html page and use your browser\'s Print → Save as PDF.' },
    privacyFaq,
  ],
  related: ['markdown-to-pdf', 'word-counter', 'diff-checker', 'case-converter'],
} satisfies Tool;

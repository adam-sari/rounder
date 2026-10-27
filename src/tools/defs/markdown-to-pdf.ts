import { privacyFaq, type Tool } from '../types';

export default [
  {
    slug: 'markdown-to-pdf',
    category: 'pdf',
    name: 'Markdown to PDF',
    title: 'Markdown to PDF Converter: themes, page numbers, no upload',
    h1: 'Markdown to *PDF*',
    description: 'Convert Markdown to a polished PDF with selectable text and clickable links. Pick a theme, A4 or Letter, margins and page numbers. Nothing is uploaded.',
    tagline: 'Write or drop in Markdown and get a paginated PDF, previewed page by page.',
    keywords: ['markdown to pdf', 'md to pdf', 'convert markdown to pdf', 'markdown pdf converter', 'readme to pdf', 'export markdown as pdf', 'markdown to pdf online', 'github markdown to pdf'],
    island: 'MarkdownToPdf',
    steps: [
      'Type or paste Markdown, or open a .md file. The page-by-page preview updates as you write.',
      'Choose a theme, A4 or Letter, the margins and where the page numbers go.',
      'Click Download PDF, or use Print to save it through your browser instead.',
    ],
    faq: [
      { q: 'What is the difference between Download PDF and Print?', a: 'Download PDF builds the file right here and matches the preview page for page, with selectable text and clickable links. Print opens your browser\'s print dialog, where you pick "Save as PDF": the browser lays out the pages itself and uses your system\'s fonts, so every language and emoji comes through.' },
      { q: 'Which Markdown is supported?', a: 'GitHub Flavored Markdown: headings, bold, italic, strikethrough, links, images, nested lists, task lists, quotes, code blocks and tables. Raw HTML works too, with scripts and forms removed.' },
      { q: 'Why do some characters show as boxes?', a: 'Download PDF embeds fonts that cover Latin, Greek and Cyrillic scripts. Chinese, Japanese, Korean, Arabic, Hebrew, emoji and some symbols aren\'t in them. The tool lists any such characters as you type; for those documents, use Print and Save as PDF.' },
      { q: 'Do images work?', a: 'Yes, when they have a full web address (https://…) or are embedded as data URLs. Your browser downloads them from their site, the same as viewing a web page. Relative paths like images/chart.png can\'t be found from here, and some sites block other pages from using their images; those show as a labeled placeholder.' },
      privacyFaq,
    ],
    related: ['markdown-editor', 'merge-pdf', 'compress-pdf'],
  },
  {
    slug: 'html-to-pdf',
    category: 'pdf',
    name: 'HTML to PDF',
    title: 'HTML to PDF Converter: paste HTML, get a real text PDF',
    h1: 'HTML to *PDF*',
    description: 'Paste HTML or open an .html file and turn it into a PDF with selectable text and working links. Scripts are stripped and nothing is uploaded.',
    tagline: 'Paste HTML, preview the pages, and download a clean PDF.',
    keywords: ['html to pdf', 'convert html to pdf', 'html to pdf converter', 'html file to pdf', 'save html as pdf', 'html code to pdf', 'html to pdf online'],
    island: 'MarkdownToPdf',
    props: { mode: 'html' },
    variantOf: 'markdown-to-pdf',
    steps: [
      'Paste your HTML, or open an .html file. The page-by-page preview updates as you type.',
      'Choose a theme, A4 or Letter, the margins and where the page numbers go.',
      'Click Download PDF, or use Print to keep your page\'s own CSS.',
    ],
    faq: [
      { q: 'Does it keep my CSS?', a: 'Print does: your page\'s <style> rules are applied on top of the chosen theme before your browser saves the PDF. Download PDF uses the theme\'s own styling and carries over the structure: headings, paragraphs, lists, tables, images, links and code.' },
      { q: 'Can it convert a live web page from its URL?', a: 'No. It converts HTML you paste or open from a file. To save a live page, open it in your browser and use Print, then Save as PDF there.' },
      { q: 'Does JavaScript in my HTML run?', a: 'No. Scripts, event handlers and forms are removed before anything is shown, so pasted HTML can\'t run code here. Content that a page normally builds with JavaScript won\'t appear.' },
      { q: 'Why do some characters show as boxes?', a: 'Download PDF embeds fonts that cover Latin, Greek and Cyrillic scripts. Chinese, Japanese, Korean, Arabic, Hebrew and emoji aren\'t in them, and the tool tells you when that happens. Print and Save as PDF uses your system\'s fonts and keeps them.' },
      privacyFaq,
    ],
    related: ['markdown-to-pdf', 'markdown-editor', 'merge-pdf'],
  },
] satisfies Tool[];

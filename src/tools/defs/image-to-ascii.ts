import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'image-to-ascii',
  category: 'image',
  name: 'Image to ASCII art',
  title: 'Image to ASCII Art Converter: text, braille & color',
  h1: 'Image to *ASCII* art',
  description: 'Turn any photo into ASCII art. Classic, 70-character, block and braille sets, optional color, then copy the text or download TXT, PNG or HTML.',
  tagline: 'Turn a photo into text art you can paste anywhere, or save as an image.',
  keywords: ['ascii art generator', 'image to text art', 'photo to ascii', 'braille art', 'text art', 'ascii art converter', 'picture to ascii', 'jpg to ascii'],
  island: 'ImageToAscii',
  steps: [
    'Drop in a photo, logo or screenshot (JPG, PNG, WebP or HEIC).',
    'Pick a width and character set, then nudge brightness and contrast until the shapes pop.',
    'Copy the text, or download it as a .txt file, a PNG or a colored HTML page.',
  ],
  faq: [
    {
      q: 'Which character set should I use?',
      a: 'Standard is the classic look and works everywhere. Detailed uses 70 characters for smoother shading. Blocks (░▒▓█) give a bold, chunky result, and braille packs 8 dots into each character, so it shows the most detail at a given width.',
    },
    {
      q: 'Why does my ASCII art look inverted when I paste it?',
      a: 'Dense characters read as bright on a dark background and as dark on a light one. Set "made for a background that is" to match where you will paste it, such as a dark terminal or a white document, or tick Invert.',
    },
    {
      q: 'Why do the lines look misaligned after pasting?',
      a: 'ASCII art needs a monospace font, where every character is the same width. Paste it into a code block, a terminal or a plain-text editor. Braille characters may also look uneven in fonts that lack them, so the PNG download is the safest way to share that style.',
    },
    {
      q: 'Can I keep the colors?',
      a: 'Yes. Turn on Color and download the PNG or the HTML page, where each character keeps the color of that spot in the photo. Copied plain text has no color, since plain text cannot carry it.',
    },
    filePrivacyFaq,
  ],
  related: ['pixel-art-maker', 'image-resizer', 'crop-image'],
} satisfies Tool;

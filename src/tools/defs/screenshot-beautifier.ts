import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'screenshot-beautifier',
  category: 'creator',
  name: 'Screenshot beautifier',
  title: 'Screenshot Beautifier: add backgrounds & frames, no watermark',
  h1: 'Screenshot *beautifier*',
  description: 'Paste a screenshot and put it on a gradient with padding, rounded corners, shadow and a macOS or browser frame. Copy or download, no watermark.',
  tagline: 'Paste a screenshot, get a polished image for X, LinkedIn or Slack.',
  keywords: ['beautify screenshot', 'screenshot background', 'screenshot mockup', 'add background to screenshot', 'mac window frame', 'browser mockup', 'pretty screenshot', 'screenshot to tweet'],
  island: 'ScreenshotBeautifier',
  steps: [
    'Press ⌘V or Ctrl+V to paste a screenshot, or drop in an image file.',
    'Pick a background, then tune padding, corners, shadow and an optional window frame or caption.',
    'Choose a canvas shape for the platform you are posting to, then download or copy the image.',
  ],
  faq: [
    { q: 'Is there a watermark or an export limit?', a: 'No. Downloads and copies are full quality with no watermark, no sign-up and no daily limit.' },
    { q: 'What size is the exported image?', a: 'At 2× (the default) the screenshot is drawn at up to 2,880 px on its longest side, so it stays sharp on high-density screens. The whole image is capped at about 16 megapixels so the export works in every browser, including on iPhone.' },
    { q: 'How do I paste the result into X, Slack or Google Docs?', a: 'Click "Copy image", then paste with ⌘V or Ctrl+V. The image is copied as a PNG. If your browser blocks clipboard access, use Download instead.' },
    { q: 'Can I keep the background transparent?', a: 'Yes. Pick "none" as the background and download a PNG or WebP. The window, shadow and caption are kept and everything around them stays transparent.' },
    filePrivacyFaq,
  ],
  related: ['image-resizer', 'crop-image', 'watermark-image', 'image-compressor'],
  flagship: { elsewhere: 'Watermark or paid export', here: 'Free, full-quality exports' },
} satisfies Tool;

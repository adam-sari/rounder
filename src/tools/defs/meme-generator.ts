import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'meme-generator',
  category: 'image',
  name: 'Meme generator',
  title: 'Meme Generator: add text to any image, no watermark',
  h1: 'Meme *generator*',
  description: 'Make memes from your own images. Classic top and bottom text, caption bar memes, draggable text boxes. Free, no watermark, nothing uploaded.',
  tagline: 'Classic Impact text or a caption bar, on any picture you bring.',
  keywords: ['make a meme', 'meme maker', 'add text to image', 'impact font meme', 'caption meme', 'meme generator no watermark', 'top text bottom text', 'put text on picture'],
  island: 'MemeGenerator',
  steps: [
    'Drop in an image or start from a blank canvas.',
    'Type your top and bottom text, switch to a caption bar, or add extra text boxes and drag them into place.',
    'Download as PNG or JPG at full resolution, or copy it straight to your clipboard.',
  ],
  faq: [
    { q: 'Does it add a watermark?', a: 'No. What you download is exactly what you see in the preview, at the full resolution of your image.' },
    { q: 'Where are the meme templates?', a: "There's no template library. You bring your own image: a photo, a screenshot or a picture you saved. Drop it in, choose it, or paste it with Ctrl+V or ⌘V." },
    { q: 'Which font does it use?', a: 'Classic text uses Impact, the traditional meme font, with a black outline. If your device doesn\'t have Impact, it falls back to Anton, Arial Black or the boldest font your browser has. Caption bars use Helvetica or Arial.' },
    { q: 'What is the caption bar style?', a: 'It puts a white bar above the image with black text, the format common on Twitter and Instagram. You can still add outlined text boxes on the image itself.' },
    filePrivacyFaq,
  ],
  related: ['watermark-image', 'crop-image', 'collage-maker', 'image-resizer'],
  flagship: { elsewhere: 'Watermark stamped on free memes', here: 'No watermark, full resolution' },
} satisfies Tool;

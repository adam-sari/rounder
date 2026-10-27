import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'object-remover',
  category: 'ai',
  name: 'Object remover (magic eraser)',
  title: 'Remove Objects from Photos: free AI magic eraser, full HD',
  h1: 'Object *remover*',
  description: 'Paint over people, text, wires or blemishes and AI fills the gap. Free at full resolution, no sign-up or watermark. Runs on your device; nothing is uploaded.',
  tagline: 'Paint over what you don\'t want and AI fills it in, right on your device.',
  keywords: ['remove object from photo', 'magic eraser', 'remove people from photo', 'cleanup pictures', 'ai photo eraser', 'remove text from image', 'inpainting', 'erase background objects', 'retouch photo'],
  island: 'ObjectRemover',
  steps: [
    'Drop in a photo, then download the AI model once (28 MB, or 208 MB for high quality).',
    'Paint over the things you want gone with the brush. Zoom in for fine details; the eraser takes paint back.',
    'Press Remove, repeat on anything left over, compare before and after, and download at full resolution.',
  ],
  faq: [
    { q: 'How does it work?', a: 'It\'s AI. An inpainting model looks at the area around your marks and paints in what was probably behind the object. It runs on your device through your browser. The first time, it downloads the model (28 MB) plus the AI engine that runs it (14–27 MB); both then stay in your browser\'s cache. The AI can make mistakes: it works best on backgrounds like sky, grass, walls and water, and it guesses on complex ones. Undo, paint again and press Remove a second time to refine the result.' },
    { q: 'Which AI model does it use?', a: 'Standard mode uses MI-GAN by Andranik Sargsyan et al. at Picsart AI Research, released under the MIT license. It\'s fast and works on phones. High quality mode uses Big LaMa by Roman Suvorov et al. (Apache-2.0), a 208 MB download that handles larger holes better and suits computers. Both run locally through ONNX Runtime Web, on your graphics card with WebGPU or on your processor.' },
    { q: 'Will it lower the resolution of my photo?', a: 'No. The model works on a crop around each painted area. Only the painted area and a thin blended edge are replaced; every other pixel is left as it was (save as PNG to keep them bit-for-bit, since JPG re-compresses). The fill itself is drawn at up to 512 × 512, so a very large area can look soft: remove big things a piece at a time. You download the full-size photo, with no watermark and no paid HD export.' },
    { q: 'Can I use it to remove watermarks?', a: 'Use it on your own photos, or on images you have the rights to edit. Removing a watermark or credit from someone else\'s image to reuse it can break copyright law and the creator\'s license, so please don\'t.' },
    filePrivacyFaq,
  ],
  related: ['background-remover', 'image-upscaler', 'blur-image', 'crop-image'],
  flagship: { elsewhere: 'HD export behind a subscription', here: 'Full resolution, free, on your device' },
} satisfies Tool;

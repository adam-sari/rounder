import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'image-upscaler',
  category: 'ai',
  name: 'AI image upscaler',
  title: 'AI Image Upscaler: enlarge photos 4×, free, no watermark',
  h1: 'AI image *upscaler*',
  description: 'Upscale images 2× or 4× with AI that runs in your browser. Sharper photos with no watermark, no sign-up and no credits. Nothing is uploaded.',
  tagline: 'Enlarge photos 2× or 4× with AI that runs on your own device.',
  keywords: ['upscale image', 'ai upscaler', 'increase image resolution', 'enhance photo', 'enlarge image', '4x upscale', 'image enhancer', 'super resolution', 'unblur image'],
  island: 'ImageUpscaler',
  steps: [
    'Pick 2× (quick, for clean images) or 4× (for photos), then download the model once.',
    'Drop in a JPG, PNG, WebP or HEIC. The image is upscaled tile by tile, and you can watch it sharpen.',
    'Zoom in to compare before and after, then download it as JPG, PNG or WebP.',
  ],
  faq: [
    {
      q: 'Which AI model does this use?',
      a: 'Swin2SR by Marcos V. Conde et al., released under the Apache 2.0 license. 2× uses the lightweight model (about 8.1 MB); 4× uses the real-world model trained on degraded photos (about 54 MB on a graphics card, 19 MB on the processor). We use the ONNX conversions published on Hugging Face and run them with Transformers.js.',
    },
    {
      q: 'How long does it take?',
      a: 'With WebGPU (recent Chrome or Edge on a computer), a typical photo takes seconds to a minute. Without it, the model runs on the processor: 2× takes a few minutes for a 1000 px image, and 4× can take ten minutes or more. The page shows an estimate before you start and the time left as it works. The first visit also downloads the model once; after that it loads from your browser.',
    },
    {
      q: 'Why is there a size limit?',
      a: 'The limit is on the result. 4× turns a 1500 px image into 6000 px (up to 36 megapixels), and a browser tab runs short of memory beyond that. We work on images up to 1500 px for 4× and 3000 px for 2× (1024 and 2048 px on phones). Bigger images can be shrunk first, or cropped to the part you need.',
    },
    {
      q: 'Will it really add detail?',
      a: "It's AI, so it predicts detail rather than recovering it. Edges get crisper and blur, noise and JPEG blocks are cleaned up, but faces, small text and fine patterns can come out slightly different from the real thing. Zoom in and check before you print or publish.",
    },
    filePrivacyFaq,
  ],
  related: ['background-remover', 'photo-colorizer', 'image-resizer', 'image-compressor'],
  next: ['image-compressor'],
  flagship: { elsewhere: '2× free, 4× behind credits or a watermark', here: '2× and 4×, unlimited, no watermark' },
} satisfies Tool;

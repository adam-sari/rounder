import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'photo-colorizer',
  category: 'ai',
  name: 'Colorize black & white photos',
  title: 'Colorize Black & White Photos: free AI photo colorizer',
  h1: 'Colorize black & white *photos*',
  description: 'Colorize old black-and-white photos with AI, free and at full resolution. It runs on your device: no upload, no sign-up, no watermark and no credits.',
  tagline: 'Bring old family photos to life with natural color, made by AI right in your browser.',
  keywords: ['colorize photo', 'colorize black and white photo', 'ai photo colorizer', 'add color to old photos', 'colorize old photos free', 'black and white to color', 'photo colorization', 'restore old photo color', 'myheritage colorize alternative'],
  island: 'PhotoColorizer',
  steps: [
    'Download the AI model once (about 135 MB), then drop in one or more black-and-white photos.',
    'The AI adds color on your device. Drag the slider to compare the original with the colorized photo.',
    'Turn the color strength up or down if you like, then download a full-resolution JPG or PNG.',
  ],
  faq: [
    {
      q: 'How accurate are the colors?',
      a: "They are the AI's best guess, not a record of the real colors, which a black-and-white photo never captured. Skies, skin, grass and trees usually look natural. Clothing, cars and painted walls could have been any color, so the AI picks a likely one. Check the result, and use the color strength slider if it looks too strong or too faint.",
    },
    {
      q: 'Does colorizing lower the resolution?',
      a: 'No. The AI works out the colors on a 512 × 512 copy, but the brightness and fine detail come from your original photo at its full size. Only the color layer is scaled up, which the eye barely notices, so the download is as large and as sharp as the photo you put in.',
    },
    {
      q: 'Which AI model does it use?',
      a: 'DDColor tiny by Xiaoyang Kang and colleagues (ICCV 2023), released under the Apache-2.0 license, in an ONNX export by Edge Tools. It downloads once (about 135 MB) and stays in your browser. When your browser can use your graphics card (WebGPU), a photo takes a second or two. The model is published in half precision, which graphics cards compute too coarsely for it (the colors come out wrong), so it is converted to full precision on your device first. Without a usable graphics card it runs on your processor: about 10–15 seconds per photo on a computer, and it needs over a gigabyte of free memory, so older phones may run out.',
    },
    {
      q: 'Can I use it on sepia or faded color photos?',
      a: "Yes. The AI only looks at brightness, so a sepia tint or faded color is replaced with fresh color. If you want to keep some of the old feel, lower the color strength before you download.",
    },
    filePrivacyFaq,
  ],
  related: ['image-upscaler', 'object-remover', 'background-remover', 'image-compressor'],
  next: ['image-upscaler', 'image-compressor'],
  flagship: { elsewhere: 'A few free photos, then a subscription', here: 'Unlimited photos, full size, no watermark' },
} satisfies Tool;

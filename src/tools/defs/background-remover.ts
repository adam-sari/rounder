import { MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'background-remover',
  category: 'ai',
  name: 'Background remover',
  title: 'Background Remover: remove image backgrounds free, full size',
  h1: 'Background *remover*',
  description: 'Remove the background from photos with AI that runs on your device. Full-size transparent PNGs, batches, new backgrounds. Free, and nothing is uploaded.',
  tagline: 'Cut out people, products and pets at full resolution, with AI that runs on your own device.',
  keywords: ['remove background', 'remove bg', 'transparent background', 'background eraser', 'remove background from image', 'cut out image', 'white background', 'product photo background', 'remove.bg alternative'],
  island: 'BackgroundRemover',
  steps: [
    'Pick Best (any subject, needs WebGPU) or Fast (people, works on phones). The model downloads once, then stays in your browser.',
    'Drop in one photo or a whole batch. Each one is cut out on your device; use touch up to erase leftovers or restore missed bits.',
    'Keep it transparent or pick a color, a blurred version of the original or your own image, then download full size or all as a zip.',
  ],
  faq: [
    {
      q: 'Which AI model does it use?',
      a: 'Best mode uses BiRefNet lite by Peng Zheng et al. (MIT license), a 115 MB download that needs WebGPU. Fast mode uses MODNet by Zhanghan Ke et al. (Apache-2.0), a 13 MB model made for people that also runs on phones (26 MB on a graphics card). Each downloads once from Hugging Face, then runs offline in your browser.',
    },
    {
      q: 'Is the result really full resolution?',
      a: 'Yes. The model looks at a 1024-pixel copy of your photo, then the cut-out is scaled back up with an edge-aware filter that follows the edges in your original pixels, so hair and outlines stay crisp. The download has the same pixel size as your photo, or the subject\'s size if you crop. Photos over 50 megapixels (16 on phones) are scaled down to fit in memory, and the file list tells you when.',
    },
    {
      q: 'Why are some edges wrong?',
      a: 'It\'s AI, so it can make mistakes: wispy hair against a busy background, glass and see-through things, or a subject in the same colors as its background. Switch to touch up and paint over the spot with erase or restore. Fast mode only knows people, so use Best for products, pets and objects.',
    },
    {
      q: 'Is there a limit on images or size?',
      a: 'No credits, no daily cap, no watermark and no "HD" upcharge. Everything runs on your device, so the only limits are its memory and speed. On a graphics card a photo usually takes a second or two.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Best · any subject', effect: 'BiRefNet lite, a 115 MB model downloaded once and cached. It finds people, pets and products with fine edges, but needs WebGPU: at its 1024×1024 working size it wants more memory than WebAssembly allows.' },
      { name: 'Fast · people', effect: 'MODNet, a much smaller model made for portraits. Phones and browsers without WebGPU start with it; it isn\'t meant for objects.' },
      { name: 'Background', effect: 'Transparent, a solid color, the original photo blurred (5–100), or an image of your own. "Soft shadow" adds a shadow under the subject; "crop to the subject" trims to it with a little space around.' },
      { name: 'Touch up', effect: 'A brush that erases leftovers or brings back parts the model removed; the mask follows your strokes at full resolution.' },
      { name: 'Save as', effect: 'PNG or WebP keep transparency. JPG is offered once there is a background, since it can\'t store transparency.' },
    ],
    results: [
      { input: '12 MP portrait photo (3024×4032), JPG, 3.0 MB', setting: 'Best model on the graphics card, transparent PNG', output: '10 MB PNG at full 3024×4032', note: '12–18 s from dropping the photo (two runs), model already downloaded' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'PNG', about: 'Lossless with transparency, so a full-resolution cut-out is large (10 MB for 12 MP). Best for editing and design apps.' },
      { name: 'WebP', about: 'Transparent too, and far smaller; good for websites and online stores.' },
      { name: 'JPG', about: 'Only with a color, blur or image background. Smallest, opens everywhere.' },
    ],
  },
  related: ['image-upscaler', 'object-remover', 'passport-photo-maker', 'video-background-remover'],
  next: ['crop-image', 'image-upscaler'],
  flagship: { elsewhere: 'Paid credits for full-size downloads', here: 'Full resolution, unlimited, free' },
} satisfies Tool;

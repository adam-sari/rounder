import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'social-media-image-resizer',
  category: 'creator',
  name: 'Social media image resizer',
  title: 'Social Media Image Resizer: every platform size at once',
  h1: 'Social media image *resizer*',
  description: 'Resize one image for Instagram, Facebook, X, LinkedIn, YouTube, Pinterest, TikTok and Threads at once. Crop around your subject or blur fill, zip download.',
  tagline: 'One image in, every post, story, banner and cover size out.',
  keywords: ['social media image resizer', 'resize image for instagram', 'instagram story size', 'twitter header size', 'linkedin banner size', 'youtube banner size', 'facebook cover photo size', 'resize photo for social media'],
  island: 'SocialResizer',
  steps: [
    'Drop in one image and click the part that must stay in frame.',
    'Tick the sizes you need, and choose crop, blur fill or color fill for each.',
    'Drag any preview to fine-tune its crop, then download them all as a zip.',
  ],
  faq: [
    { q: 'What do crop, blur fill and color fill do?', a: 'Crop fills the whole frame and trims what doesn\'t fit, centered on your focus point. Blur fill and color fill keep the entire image visible and fill the leftover space with a blurred copy of the picture or a solid color.' },
    { q: 'Will my images lose quality?', a: 'Each size is made from your original with high-quality Lanczos resampling and saved as JPG at quality 90, or as lossless PNG. If your image is smaller than a size, it has to be enlarged and the card tells you so.' },
    { q: 'Are these the official sizes?', a: 'They are the sizes the platforms recommend or display, as commonly published. Platforms change their layouts from time to time, so for covers and banners keep important content toward the middle, where every device shows it.' },
    { q: 'Why is there a box on the YouTube banner?', a: 'A YouTube channel banner is 2560 × 1440, but only the middle 1546 × 423 shows on every device. The dashed box marks that safe area. It is only on the preview, not in the file.' },
    filePrivacyFaq,
  ],
  related: ['youtube-thumbnail-maker', 'image-resizer', 'crop-image', 'collage-maker'],
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'youtube-thumbnail-maker',
  category: 'creator',
  name: 'YouTube thumbnail maker',
  title: 'YouTube Thumbnail Maker: free 1280×720, no watermark',
  h1: 'YouTube thumbnail *maker*',
  description: 'Design 1280×720 YouTube thumbnails with bold outlined text, stickers, arrows and emoji. Preview it in the feed, export under 2 MB. No watermark.',
  tagline: 'Big bold text, a photo and an arrow or two, checked at the size people actually see it.',
  keywords: ['youtube thumbnail maker', 'thumbnail creator', 'make youtube thumbnail', 'youtube thumbnail size', '1280x720 thumbnail', 'thumbnail maker no watermark', 'free thumbnail maker', 'thumbnail text'],
  island: 'ThumbnailMaker',
  steps: [
    'Drop in a photo for the background, or pick a gradient or color. Drag the photo to frame it.',
    'Edit the headline, wrap a word in *stars* to make it pop, and add images, arrows, circles or emoji.',
    'Check the small feed preview, then download a 1280 × 720 JPG that stays under 2 MB.',
  ],
  faq: [
    { q: 'What size is a YouTube thumbnail?', a: '1280 × 720 pixels, a 16:9 shape. YouTube asks for custom thumbnails under 2 MB in JPG, PNG or GIF. This tool always exports at 1280 × 720, and JPG downloads automatically pick the highest quality that stays under 2 MB.' },
    { q: 'How do I make one word a different color?', a: 'Wrap it in asterisks, like "This changed *everything*". Marked words use the accent color, or get their own highlight box if you choose "behind *words*".' },
    { q: 'Can I add a cut-out photo of myself?', a: 'Yes. Drop in a PNG with a transparent background and it is added as a sticker you can move, resize and rotate. Turn on "sticker border" for the white outline that makes cut-outs stand out.' },
    { q: 'What is the timestamp zone?', a: 'In the feed, YouTube shows the video length in the bottom-right corner, on top of your thumbnail. The dashed box marks roughly where it sits so you can keep faces and text clear of it. It is never part of the download.' },
    filePrivacyFaq,
  ],
  related: ['social-media-image-resizer', 'screenshot-beautifier', 'meme-generator', 'image-compressor'],
  flagship: { elsewhere: 'Watermark or sign-up to download', here: 'Free downloads, no watermark, no account' },
} satisfies Tool;

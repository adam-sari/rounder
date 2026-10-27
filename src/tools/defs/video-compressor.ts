import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'video-compressor',
  category: 'video',
  name: 'Video compressor',
  title: 'Video Compressor: shrink MP4 to any size, no upload',
  h1: 'Video *compressor*',
  description: 'Compress MP4, MOV, WebM and more to a target size like 10 MB for Discord, or by quality. No upload, no watermark and no file-size cap.',
  tagline: 'Shrink videos to fit Discord, email or anywhere else, right on your device.',
  keywords: ['compress video', 'reduce video size', 'compress mp4', 'compress video for discord', 'compress video to 10mb', 'make video smaller', 'shrink video file', 'compress mov'],
  island: 'VideoCompressor',
  steps: [
    'Drop in one video or a whole batch (MP4, MOV, WebM, MKV, AVI and more).',
    'Pick a target size like 10 MB for Discord, or a quality level, and check the size estimate.',
    'Compress, compare the result with the original, and download.',
  ],
  faq: [
    { q: 'How do I get a video under 10 MB for Discord?', a: 'Choose "Target size" and the 10 MB preset. The tool works out the bitrate that fits, and on "Auto" it lowers the resolution when the budget is too thin to keep full size sharp. Long videos may still need trimming first: an hour of video in 10 MB will not look good at any resolution.' },
    { q: 'Which codec should I pick?', a: 'H.264 plays on practically everything, so it is the safe default. HEVC, AV1 and VP9 make smaller files at the same quality, but some phones, TVs and apps cannot play them. Only the codecs your browser can encode are offered.' },
    { q: 'Is there a file-size limit?', a: 'Not from us. The video is processed on your device, so the only limits are your computer\'s memory and disk space. Very large results are written to your browser\'s private storage rather than kept in memory.' },
    { q: 'What if the compressed video comes out bigger?', a: 'Then you get the original back, untouched, and the tool tells you so. That can happen with videos that are already heavily compressed.' },
    filePrivacyFaq,
  ],
  related: ['trim-video', 'resize-video', 'video-converter', 'video-to-gif'],
  flagship: { elsewhere: '100–500 MB caps or a watermark', here: 'Any size, no watermark' },
} satisfies Tool;

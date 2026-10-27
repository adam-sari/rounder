import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'resize-video',
  category: 'video',
  name: 'Resize video (9:16, 1:1, 16:9)',
  title: 'Resize Video for TikTok, Reels, Shorts & YouTube, free',
  h1: '*Resize* a video for any platform',
  description: 'Turn any video into 9:16, 1:1, 4:5 or 16:9 with a blurred or solid background, or fill the frame. Scale to 1080p, 720p or 480p. No upload.',
  tagline: 'Fit a video to TikTok, Reels, Shorts, YouTube or Instagram, with a blurred background or a clean crop.',
  keywords: ['resize video', 'video resizer', 'resize video for instagram', 'resize video for tiktok', 'change video aspect ratio', 'horizontal to vertical video', '16:9 to 9:16', 'blur background video', 'reduce video resolution', 'video to 1080p'],
  island: 'ResizeVideo',
  steps: [
    'Drop in a video from your phone, camera or screen recorder.',
    'Pick a platform like TikTok or YouTube, type a custom size, or scale down to 1080p, 720p or 480p. Choose a blurred background, a solid color, or fill the frame and slide to pick what stays in view.',
    'Export and download. The sound is kept, and nothing leaves your device.',
  ],
  faq: [
    { q: 'What size should I use for TikTok, Reels and Shorts?', a: 'All three are vertical 9:16 video, and 1080 × 1920 pixels is the usual choice. Instagram feed posts can be square (1080 × 1080) or 4:5 portrait (1080 × 1350), and regular YouTube videos are 16:9, typically 1920 × 1080.' },
    { q: 'What\'s the difference between fit and fill?', a: 'Fit keeps your whole video in view and fills the empty space with a blurred copy of the video or a color you pick. Fill zooms in until there are no bars, cropping the sides or the top and bottom; drag the preview or use the focus slider to choose which part stays in frame.' },
    { q: 'Can I make a video smaller without changing its shape?', a: 'Yes. Choose "scale down" and pick 1080p, 720p or 480p. The shape stays the same and the file usually gets much smaller, which helps with email and chat apps.' },
    { q: 'Will a small video look sharp at 1080 × 1920?', a: 'If your video is smaller than the size you pick, it has to be enlarged, and that can\'t add detail, so it may look a little soft. The tool tells you when that\'s the case.' },
    filePrivacyFaq,
  ],
  related: ['crop-video', 'video-compressor', 'video-converter', 'trim-video'],
  next: ['video-compressor'],
  flagship: { elsewhere: 'Watermarks, or 1080p only on paid plans', here: 'Full 1080p, no watermark, no sign-up' },
} satisfies Tool;

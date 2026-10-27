import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'crop-video',
  category: 'video',
  name: 'Crop video',
  title: 'Crop Video Online: free, no watermark, 9:16 for TikTok',
  h1: '*Crop* a video',
  description: 'Crop videos to 9:16, 1:1, 4:5 or exact pixels by dragging a box. Works with phone videos. No upload, no watermark, no file-size cap.',
  tagline: 'Drag a box over your video, pick a ratio, and download just that part.',
  keywords: ['crop video', 'crop mp4', 'video cropper', 'crop video for tiktok', 'crop video to square', 'crop video 9:16', 'crop video online free', 'remove black bars from video', 'zoom in on video'],
  island: 'CropVideo',
  steps: [
    'Drop in a video: MP4, MOV, WebM, MKV and most other formats.',
    'Drag the box or its handles, pick a ratio like 9:16 or 1:1, or type the exact pixels. Press play to check the framing.',
    'Choose a format and download the cropped video. The sound is kept.',
  ],
  faq: [
    { q: 'Does cropping lower the quality?', a: 'The pixels inside the box are kept at their full resolution. The video does have to be re-encoded to change its frame, which is done at a high quality setting, so most people can\'t tell the difference. Picking a smaller output size like 720p makes the file smaller too.' },
    { q: 'How do I crop a video for TikTok, Reels or Shorts?', a: 'Choose 9:16. The box becomes the tallest vertical slice of your video; drag it sideways to keep the subject in frame. If you\'d rather keep the whole picture with a blurred or colored background around it, use the resize video tool instead.' },
    { q: 'Does it work with videos from my phone?', a: 'Yes. Videos recorded upright or sideways are shown the way they play, and the crop is applied exactly as you see it. If your browser can\'t decode a file, such as some iPhone HEVC videos or old AVI files, we offer a one-time decoder download so it still opens.' },
    { q: 'Is there a length or file-size limit?', a: 'Not from us, and there\'s no watermark. Everything runs on your device, so long or 4K videos simply take longer and need enough free memory.' },
    filePrivacyFaq,
  ],
  related: ['resize-video', 'trim-video', 'rotate-video', 'video-compressor'],
  next: ['video-compressor'],
  flagship: { elsewhere: 'Watermarks on free exports and upload size caps', here: 'No watermark, no upload, no size cap' },
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'trim-video',
  category: 'video',
  name: 'Video trimmer / cutter',
  title: 'Trim Video Online: cut clips to the frame, free, no upload',
  h1: 'Trim & cut *video*',
  description: 'Trim the start and end of a video or cut parts out of the middle, accurate to the frame. MP4, MOV, WebM and more. No upload, no watermark.',
  tagline: 'Keep the good part and cut the rest, right down to the frame.',
  keywords: ['trim video', 'cut video', 'video cutter', 'video trimmer', 'trim mp4', 'cut mp4', 'shorten video', 'remove part of video', 'clip video'],
  island: 'TrimVideo',
  steps: [
    'Drop in a video: MP4, MOV, WebM, MKV, or AVI and other older formats.',
    'Drag the yellow handles, or play to a moment and press I and O. Switch to "cut out parts" to remove bits from the middle.',
    'Preview the loop, pick a format and quality, then trim and download.',
  ],
  faq: [
    { q: 'Is the cut frame-accurate?', a: 'Yes, with the Best, High and Smaller qualities: the clip is re-encoded, so it starts and ends on exactly the frames you chose. Step through frames with the , and . keys to find them. The "no re-encode" option is much faster and loses nothing, but it can only start on a keyframe, so the clip may begin up to a few seconds early.' },
    { q: 'Will trimming lower the quality?', a: 'Best quality re-encodes at a high bitrate, capped near your original\'s so the file doesn\'t balloon, and the difference is very hard to see. If you want the original stream untouched, choose "no re-encode". It\'s offered when you keep one part, the format can hold the original video, and the clip isn\'t stored rotated (as many phone videos are).' },
    { q: 'Can I remove a part from the middle?', a: 'Yes. Switch to "cut out parts", add a segment over each bit you don\'t want, and the rest is joined back together. "Preview without cuts" plays the result before you export.' },
    { q: 'Which formats can I trim?', a: 'MP4, MOV, WebM and MKV open straight away. AVI, WMV, FLV and other older formats need a one-time 31 MB decoder download, and we ask before fetching it. The trimmed video keeps its original format when your browser can write it, otherwise it is saved as MP4.' },
    filePrivacyFaq,
  ],
  related: ['video-compressor', 'merge-videos', 'crop-video', 'video-to-gif'],
  flagship: { elsewhere: 'Upload caps and watermarks on free exports', here: 'Any length, no watermark, never uploaded' },
} satisfies Tool;

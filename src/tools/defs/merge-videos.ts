import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'merge-videos',
  category: 'video',
  name: 'Merge videos / video joiner',
  title: 'Merge Videos Online: join MP4, MOV & more, no watermark',
  h1: 'Merge *videos*',
  description: 'Join video clips into one file. Reorder, trim each clip, pick the output size, keep the sound or add music. No watermark, no uploads, no size caps.',
  tagline: 'Put clips in order, trim the ends, and get one video back.',
  keywords: ['merge videos', 'video joiner', 'combine videos', 'join mp4', 'video merger', 'combine clips', 'put videos together', 'concatenate video'],
  island: 'MergeVideos',
  steps: [
    'Drop in your clips (MP4, MOV, WebM, MKV, AVI and more), then drag them into order.',
    'Open Trim on any clip to cut its start or end, and pick the output size and sound.',
    'Press Merge and download the finished video when it is done.',
  ],
  faq: [
    {
      q: 'Can I merge clips with different sizes or shapes?',
      a: 'Yes. Every clip is scaled to the output size you pick. Clips with a different shape either get bars (in a color you choose) or are cropped to fill the frame.',
    },
    {
      q: 'Is there a crossfade between clips?',
      a: 'Not yet. Clips are joined with straight cuts. If you want a softer change, trim each clip so it ends on a calm moment.',
    },
    {
      q: 'Can I add music?',
      a: "Yes. Pick Background music under Sound and choose an audio file (or a video, to use its soundtrack). It replaces the clips' own sound and is cut off where the video ends. A volume slider lets you make it louder or quieter.",
    },
    {
      q: 'Is there a limit on clips, length or file size?',
      a: "No clip limit, no length limit and no size cap. Everything runs on your device, so speed depends on your computer: longer videos take longer, and very large merges need plenty of free memory.",
    },
    filePrivacyFaq,
  ],
  related: ['trim-video', 'video-compressor', 'add-audio-to-video', 'resize-video'],
  flagship: { elsewhere: 'Watermarks, upload limits or a paid plan', here: 'No watermark, no uploads, no caps' },
} satisfies Tool;

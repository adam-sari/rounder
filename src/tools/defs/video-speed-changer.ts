import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'video-speed-changer',
  category: 'video',
  name: 'Video speed changer',
  title: 'Video Speed Changer: speed up or slow down a video, free',
  h1: 'Video speed *changer*',
  description: 'Speed up or slow down a video from 0.25× to 4×. Keep voices at their normal pitch, let the pitch follow, or mute. Nothing is uploaded.',
  tagline: 'Make a clip faster or slower, with the sound kept natural, tape-style or muted.',
  keywords: ['video speed changer', 'speed up video', 'slow down video', 'slow motion video', 'change video speed', 'fast forward video', '2x speed video', 'timelapse from video'],
  island: 'VideoSpeed',
  steps: [
    'Drop in your video: MP4, MOV, WebM, MKV and most other formats.',
    'Pick a speed from 0.25× to 4× and choose what happens to the sound. The preview plays at that speed.',
    'Save and download the re-timed video, with no watermark.',
  ],
  faq: [
    {
      q: 'Will voices sound like chipmunks?',
      a: 'Only if you want them to. "Keep pitch" time-stretches the sound so voices stay at their normal pitch, though very fast or very slow speeds can add a slight warble. "Pitch follows" works like a tape played faster or slower, so voices go higher or deeper. "Mute" drops the sound.',
    },
    {
      q: 'Is the slow motion smooth?',
      a: 'It stretches the frames the video already has; it doesn\'t invent new in-between frames (that\'s called frame interpolation, and this tool doesn\'t do it). So 30 fps footage slowed to 0.5× plays at 15 fps. Footage filmed at 60 fps or more, like a phone\'s slow-motion or high frame rate mode, stays much smoother when slowed down.',
    },
    {
      q: 'What happens to the frame rate when I speed a video up?',
      a: 'Speeding up packs the frames closer together. Above 60 frames per second, extra frames are dropped, so a 30 fps clip at 4× plays at 60 fps. That\'s as smooth as most screens can show anyway, and it keeps the file size sensible.',
    },
    {
      q: 'Is there a limit on length or file size?',
      a: 'Not from us: everything runs on your own device. One caveat is "keep pitch", which holds the stretched sound in memory, so for very long videos at slow speeds it may be unavailable. "Pitch follows" and "mute" work at any length.',
    },
    filePrivacyFaq,
  ],
  related: ['trim-video', 'video-to-gif', 'audio-speed-changer', 'mute-video'],
  flagship: { elsewhere: 'Watermarks and upload size caps on free plans', here: 'No watermark, no size cap, no upload' },
} satisfies Tool;

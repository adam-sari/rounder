import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'video-frame-extractor',
  category: 'video',
  name: 'Video to JPG / frame grabber',
  title: 'Video Frame Extractor: save video frames as JPG or PNG',
  h1: 'Video *frame* extractor',
  description: 'Grab the exact frame you want from a video, or extract frames every few seconds. Full-resolution JPG, PNG or WebP, a zip or a contact sheet. No upload.',
  tagline: 'Pause on the perfect moment and save it as a full-resolution image.',
  keywords: ['video to jpg', 'extract frames from video', 'video frame grabber', 'save frame from video', 'video to png', 'mp4 to jpg', 'video screenshot', 'video contact sheet', 'video to images'],
  island: 'FrameExtractor',
  steps: [
    'Drop in a video: MP4, MOV, WebM, MKV and more.',
    'Scrub to the moment you want and click Grab this frame, or extract evenly spaced frames, one every few seconds, or every frame of a short stretch.',
    'Download single stills, all of them as a zip, or one contact sheet with timestamps.',
  ],
  faq: [
    { q: 'Are the frames full resolution?', a: 'Yes. Each frame is decoded straight from the video at its full display size, for example 1920×1080 for a 1080p clip, and phone videos come out the right way up. It isn\'t a screenshot of the player, so there are no controls or scaling in the picture.' },
    { q: 'How do I get one exact frame?', a: 'Pause the player near the moment, then step one frame at a time with the arrow buttons, or the comma and period keys while the player is focused. "Grab this frame" saves exactly what you see, and the file name records its timestamp.' },
    { q: 'How many frames can I extract at once?', a: 'Up to 500 per batch, because every full-size still takes memory on your device. Run another batch for more. "All frames" saves every frame of the stretch you select, so keep that range short: one second of 30 fps video is already 30 images.' },
    { q: 'What is a contact sheet?', a: 'One image with your frames laid out in a grid, each labelled with its timestamp, plus the file name and length at the top. It\'s a quick way to share an overview of a video or pick shots for an edit.' },
    filePrivacyFaq,
  ],
  related: ['video-to-gif', 'trim-video', 'youtube-thumbnail-maker', 'video-to-mp3'],
} satisfies Tool;

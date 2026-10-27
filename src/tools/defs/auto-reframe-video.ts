import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'auto-reframe-video',
  category: 'ai',
  name: 'Auto reframe: horizontal to vertical video',
  title: 'Auto Reframe Video: Horizontal to Vertical with AI, Free',
  h1: 'Auto *reframe* horizontal video to vertical',
  description: 'Turn landscape video into 9:16, 1:1 or 4:5. AI follows faces and scene cuts, and you can fix any moment. Runs on your device: no upload, no watermark.',
  tagline: 'AI keeps the speaker in frame as your video becomes a Short, Reel or TikTok, and you can steer it.',
  keywords: [
    'auto reframe video',
    'horizontal to vertical video',
    'landscape to portrait video',
    'convert video to 9:16',
    'reframe video for tiktok',
    'youtube video to shorts',
    'ai video cropper',
    'auto crop video to vertical',
    'opus clip alternative',
  ],
  island: 'AutoReframe',
  steps: [
    'Drop in a horizontal video. The first time, a small face-detection model (about 15 MB with its engine) downloads once.',
    'The AI watches your video for faces, movement and scene cuts, then plans a smooth vertical frame. Pick 9:16, 1:1 or 4:5 and how calm the camera should be.',
    'Play it back, drag the frame wherever it guessed wrong, and download. The sound is kept.',
  ],
  faq: [
    {
      q: 'How does it decide what stays in the frame?',
      a: "It looks at about five frames per second. When faces fit in the frame together, it keeps them together; when they don't, it follows the most prominent one and doesn't flip between people. With no faces, it follows movement. It also spots scene cuts, so the frame jumps with the edit instead of panning across it. It's AI and it can get things wrong, so you can drag the frame at any moment to pin it there, add more pins to make it pan, and hand back to tracking whenever you like.",
    },
    {
      q: 'Which AI model does it use, and what is its license?',
      a: "Google's MediaPipe Face Detector, using the BlazeFace short-range and full-range models, run by MediaPipe Tasks on your device. The models and MediaPipe are both licensed Apache 2.0. The first run downloads about 15 MB once (the two models plus the engine that runs them). After that your browser keeps them, so the tool starts straight away and works offline.",
    },
    {
      q: 'Does it keep the sound and the quality?',
      a: "Yes, the sound is kept. The video is re-encoded at a high quality setting, at 1080 × 1920 for 9:16 by default. A vertical slice of 1080p footage is about 608 pixels wide, so that size scales it up, as TikTok and Reels would anyway. If you'd rather keep the exact pixels, choose 'as cropped'. There's no watermark and no length limit from us.",
    },
    {
      q: 'How long does it take?',
      a: "The analysis usually runs several times faster than real time on a computer, so a one-minute clip takes around ten to twenty seconds. Exporting takes roughly as long as the video plays, or less on a fast machine. Phones work too, just more slowly. Long 4K videos need plenty of free memory.",
    },
    filePrivacyFaq,
  ],
  related: ['crop-video', 'resize-video', 'subtitle-generator', 'video-background-remover'],
  flagship: { elsewhere: 'AI reframing apps charge a subscription, use credits or add watermarks', here: 'Free AI reframing on your device, no watermark' },
} satisfies Tool;

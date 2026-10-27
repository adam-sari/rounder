import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'screen-recorder',
  category: 'video',
  name: 'Screen recorder',
  title: 'Screen Recorder: record your screen online, no watermark',
  h1: 'Screen *recorder*',
  description: 'Record your screen, a window or a browser tab with sound, your mic and a webcam bubble. No time limit, no watermark, no sign-up. Nothing is uploaded.',
  tagline: 'Record your screen, a window or a tab, with your voice and webcam if you like.',
  keywords: ['record screen', 'online screen recorder', 'screen recorder no watermark', 'record screen with audio', 'record screen and webcam', 'free screen recorder', 'screen capture video', 'loom alternative'],
  island: 'ScreenRecorder',
  steps: [
    'Pick what to share, and switch on sound, your microphone or a webcam bubble if you want them.',
    "Press Start recording, choose the screen, window or tab in your browser's picker, and wait for the 3-2-1 countdown.",
    'Pause or stop whenever you like, then download the video, or convert it to MP4 first.',
  ],
  faq: [
    { q: 'Is there a time limit or a watermark?', a: "No. Record for as long as you like, and the video shows exactly what was on screen with no logo added. The recording is kept by your browser until you download it, so the only practical limit is your device's memory and free disk space." },
    { q: 'Can it record the sound from my computer?', a: 'In Chrome and Edge, yes: share a browser tab with "Share tab audio" ticked, or on Windows and ChromeOS share the entire screen with "Share system audio". Firefox and Safari share the picture only. Your microphone works in every browser and is mixed in with the other sound.' },
    { q: 'What format is the video?', a: 'Safari and recent versions of Chrome and Edge record MP4 (H.264). Other browsers record WebM, which plays in Chrome, Firefox, Edge and VLC. Press Convert to MP4 for a file that also opens in QuickTime, on iPhones and in most video editors; the conversion runs on your device too.' },
    { q: 'Can I record my screen on a phone?', a: "Not from a web page: mobile browsers don't let websites capture the screen. Use your phone's built-in recorder instead (Screen Recording in Control Center on iPhone and iPad, Screen record in Quick Settings on Android). The webcam recorder does work on phones." },
    filePrivacyFaq,
  ],
  related: ['webcam-recorder', 'trim-video', 'video-compressor', 'video-to-gif'],
  next: ['trim-video', 'video-compressor'],
  flagship: { elsewhere: 'Watermarks or a 5–15 minute cap on free plans', here: 'No time limit and no watermark' },
} satisfies Tool;

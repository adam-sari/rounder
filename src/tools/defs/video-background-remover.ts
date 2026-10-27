import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'video-background-remover',
  category: 'ai',
  name: 'Video background remover',
  title: 'Remove Video Background with AI: free, no watermark, no upload',
  h1: 'Remove the *background* from a video',
  description: 'Remove or replace a video background with AI right in your browser: blur, color, green screen, image or transparent WebM. No watermark, no upload.',
  tagline: 'Swap the background behind people in a video or on your webcam for a blur, a color, a picture or nothing at all.',
  keywords: [
    'video background remover',
    'remove background from video',
    'change video background',
    'green screen video',
    'transparent video background',
    'blur video background',
    'virtual background',
    'unscreen alternative',
    'webcam background',
  ],
  island: 'VideoBgRemover',
  steps: [
    'Drop in a video of a person (or switch to Webcam). The first time, a small AI model of about 14 MB downloads once.',
    'Pick the new background: blur, a color such as green screen, your own image, or transparent. Play the preview and fine-tune edge softness and steadiness.',
    'Press Remove background and download the finished video. Every frame is processed on your device.',
  ],
  faq: [
    {
      q: 'Which videos does it work on?',
      a: 'It is built for people: talking heads, presenters, dancers, anyone facing the camera. It uses a "selfie" segmentation model, so pets, products and other objects are usually treated as background. It is AI, so it can make mistakes: hair, hands moving fast and busy backgrounds may show soft or flickering edges. Raise steadiness to calm flicker and edge softness to hide rough edges.',
    },
    {
      q: 'Can I get a transparent video?',
      a: 'Yes. Pick Transparent to save a WebM (VP9) with an alpha channel. It plays with transparency in Chrome, Edge and Firefox and opens in editors that read WebM transparency. If your editor doesn\'t, pick the green screen color instead and use its chroma key, which every editor has.',
    },
    {
      q: 'Which AI model is used, and what is its license?',
      a: 'MediaPipe Selfie Segmentation by Google, run with Google\'s MediaPipe engine, both under the Apache 2.0 license. The model is about 0.25 MB and the engine about 13.5 MB. They download once, are cached by your browser, and then work offline.',
    },
    {
      q: 'How long does it take?',
      a: 'It processes every frame on your device, so a 1-minute 1080p clip takes roughly one to a few minutes on a laptop, longer on a phone. Choosing 720p is much faster. The preview runs in real time on most computers.',
    },
    filePrivacyFaq,
  ],
  related: ['background-remover', 'auto-reframe-video', 'add-subtitles-to-video', 'trim-video'],
  flagship: { elsewhere: 'Unscreen and Kapwing charge for full-length, watermark-free exports', here: 'Free, no watermark, never uploaded' },
} satisfies Tool;

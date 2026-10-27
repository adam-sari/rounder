import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'webcam-recorder',
  category: 'video',
  name: 'Webcam recorder',
  title: 'Webcam Recorder: record video & take photos online, free',
  h1: 'Webcam *recorder*',
  description: 'Record video from your webcam and microphone, or snap photos, right in your browser. Pick the camera, mic and resolution. No sign-up, nothing uploaded.',
  tagline: 'Record yourself with your camera and mic, or snap a photo, in one click.',
  keywords: ['record webcam video', 'online webcam recorder', 'camera recorder online', 'record video online', 'webcam video recorder free', 'take photo with webcam', 'record myself', 'webcam capture'],
  island: 'WebcamRecorder',
  steps: [
    'Press Turn on camera and allow access when your browser asks.',
    'Choose your camera, microphone and resolution, and mirror the preview if you like.',
    'Press the red button to record (pause any time) or the camera button for a photo, then download the video or convert it to MP4.',
  ],
  faq: [
    { q: 'Is there a time limit?', a: "No. Record for as long as you like, with no watermark. The video is kept by your browser until you download it, so the only practical limit is your device's memory and free disk space." },
    { q: "Why isn't my video in 1080p or 4K?", a: 'Your camera decides. The tool asks for the resolution you pick, and a camera that can\'t deliver it hands back its closest size instead, which is shown under the preview. Many laptop webcams top out at 720p.' },
    { q: 'Why does the preview look flipped?', a: 'The preview is mirrored by default, like looking in a mirror, because that feels natural on camera. Videos and photos are saved the right way round, so text behind you reads correctly. Use the Mirror preview button to turn it off.' },
    { q: 'What format are the videos?', a: 'Safari and recent versions of Chrome and Edge record MP4 (H.264). Other browsers record WebM, which plays in Chrome, Firefox, Edge and VLC. Press Convert to MP4 for a file that also opens in QuickTime, on iPhones and in most video editors. Photos are saved as JPG.' },
    filePrivacyFaq,
  ],
  related: ['screen-recorder', 'voice-recorder', 'trim-video', 'video-to-gif'],
  next: ['trim-video', 'video-compressor'],
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'audio-noise-reduction',
  category: 'audio',
  name: 'Remove background noise from audio',
  title: 'Remove Background Noise from Audio & Video, free, no upload',
  h1: 'Remove background *noise*',
  description: 'Clean hum, hiss, fan and street noise out of voice recordings and videos with the RNNoise model. Compare before and after. Free, nothing is uploaded.',
  tagline: 'Take the hiss, hum and fan noise out of speech, with a before-and-after preview.',
  keywords: [
    'remove background noise',
    'noise reduction',
    'remove noise from audio',
    'audio noise remover',
    'remove background noise from video',
    'reduce hiss',
    'remove hum from audio',
    'clean up audio',
    'podcast noise removal',
    'denoise audio',
  ],
  island: 'NoiseReduction',
  steps: [
    'Drop in a voice recording or a video: MP3, WAV, M4A, MP4, MOV and more.',
    'Play the 15-second preview and flip between Original and Cleaned. Adjust the strength, and turn on the voice gate or volume leveling if you like.',
    'Save as WAV, MP3, M4A or the cleaned video, press Remove noise, then download the result.',
  ],
  faq: [
    {
      q: 'What kind of noise does it remove?',
      a: 'Steady noise behind speech: computer and air-conditioning fans, electrical hum, microphone hiss, traffic and street noise, room tone. It uses RNNoise, a small neural network trained to tell voices from noise. Sudden sounds like a door slam or a dog bark are reduced less reliably.',
    },
    {
      q: 'Does it work on music?',
      a: 'Not well. The model is trained to keep human speech and treat most other sounds as noise, so instruments and singing can come out thin or warbly. Use it for voice: podcasts, interviews, lectures, voice memos and video narration.',
    },
    {
      q: 'Why does my voice sound a bit robotic?',
      a: 'When there is a lot of noise, the model has to take a lot away, which can leave a watery or metallic edge. Lower the strength to blend some of the original back in; 70 to 90% is usually the sweet spot. The before-and-after preview lets you check by ear before you save.',
    },
    {
      q: 'Does a cleaned video lose picture quality?',
      a: 'Usually not. Only the soundtrack is replaced and re-encoded; the picture is copied over untouched, so it is also quick. The exception is a phone clip stored sideways with a rotation flag: its picture is re-encoded once, upright and at high quality. You can also save just the audio as WAV, MP3 or M4A.',
    },
    filePrivacyFaq,
  ],
  related: ['audio-normalizer', 'voice-recorder', 'audio-cutter', 'add-audio-to-video'],
  next: ['audio-normalizer', 'audio-to-text'],
  flagship: { elsewhere: 'Daily limits, sign-ups and uploads to someone else\'s server', here: 'Unlimited and private: the noise model runs on your device' },
} satisfies Tool;

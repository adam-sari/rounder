import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'text-to-speech',
  category: 'ai',
  name: 'Text to speech',
  title: 'Text to Speech: free natural AI voices, MP3 download, no limits',
  h1: 'Text to *speech*',
  description: 'Turn text into natural speech with 28 AI voices that run in your browser. Download MP3 or WAV, no character limits, no sign-up, nothing uploaded.',
  tagline: 'Natural AI voices made on your own device, with MP3 and WAV downloads and no character limits.',
  keywords: ['tts', 'text to voice', 'read aloud', 'ai voice generator', 'text to mp3', 'voice over', 'speech synthesis', 'natural reader', 'elevenlabs alternative'],
  island: 'TextToSpeech',
  steps: [
    'Type or paste your text. Long articles and whole chapters are fine.',
    'Pick one of 28 US or UK voices (press play on a voice to hear it) and set the speed.',
    'Press Read aloud: playback starts after the first sentence while the rest is made. Then download MP3 or WAV.',
  ],
  faq: [
    {
      q: 'Is there a character limit?',
      a: 'No. Speech is made on your device, so there are no credits, no monthly quota and no watermark. Long text is read sentence by sentence and playback starts as soon as the first one is ready.',
    },
    {
      q: 'Which AI model is used, and what is its license?',
      a: 'Kokoro 82M by hexgrad, released under the Apache-2.0 license, running through the open-source kokoro-js library. Its pronunciation step uses eSpeak NG (GPL-3.0), credited on our credits page. The first run downloads about 114 MB once (348 MB on computers with WebGPU, for the faster graphics-card version); each other voice adds about 0.5 MB the first time you pick it. After that it works offline.',
    },
    {
      q: 'How fast is it?',
      a: 'With WebGPU (recent Chrome or Edge on a computer) it makes speech many times faster than it plays. Without it, the model runs on the processor and is usually slower than playback, so longer texts pause between sentences while it catches up. The page shows the real speed as it works. It is AI, so now and then a word may come out oddly: press ↻ on that paragraph to redo it, or respell the word.',
    },
    {
      q: 'What is the Basic mode?',
      a: "Basic uses the voices built into your browser and operating system. It starts instantly with nothing to download, but the sound can't be saved as a file. Voices marked online send your text to the browser maker (Google, Microsoft or Apple) to be spoken; the others stay on your device.",
    },
    privacyFaq,
  ],
  related: ['audio-to-text', 'translator', 'voice-recorder', 'word-counter'],
  flagship: {
    elsewhere: 'Paid per character, or a few minutes a month free',
    here: 'Unlimited text, free MP3 & WAV downloads',
  },
} satisfies Tool;

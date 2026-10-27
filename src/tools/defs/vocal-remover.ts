import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'vocal-remover',
  category: 'ai',
  name: 'Vocal remover & stem splitter',
  title: 'Vocal Remover & Stem Splitter: free AI, no upload or sign-up',
  h1: 'Vocal remover & *stem* splitter',
  description: 'Remove vocals for karaoke, or split a song into vocals, drums, bass and other stems with AI that runs on your device. Free, no upload, no per-minute fees.',
  tagline: 'Karaoke tracks, acapellas and separate stems, made by an AI that runs on your own computer.',
  keywords: [
    'vocal remover',
    'remove vocals from song',
    'karaoke maker',
    'instrumental maker',
    'acapella extractor',
    'stem splitter',
    'stem separation',
    'isolate vocals',
    'remove drums from song',
    'extract bass from song',
  ],
  island: 'VocalRemover',
  steps: [
    'The first time, download the Demucs AI model (181 MB, once). After that it starts straight away.',
    'Drop in a song: MP3, WAV, FLAC, M4A or a video. The AI splits it into vocals, drums, bass and other instruments on your computer.',
    'Mute, solo and mix the stems while they play, then download the instrumental, the vocals, any single stem or all of them as a ZIP.',
  ],
  faq: [
    {
      q: 'How clean are the stems?',
      a: "Usually very good, but it's AI, so it isn't perfect. Expect a little bleed, like a trace of hi-hat in the vocals or a ghost of the singer in the instrumental, especially with heavy reverb, distorted guitars or dense mixes. Play the stems in the mixer before you download, so you know what you're getting.",
    },
    {
      q: 'Which AI model does it use, and what is its license?',
      a: "It uses the open-source Demucs model by Meta (Hybrid Transformer Demucs, \"htdemucs\", by Alexandre Défossez and colleagues), which is released under the MIT license. It runs through demucs-web (MIT) and ONNX Runtime Web (MIT). The 181 MB model is downloaded once from Hugging Face and kept in your browser's cache, and the song itself never leaves your device.",
    },
    {
      q: 'How long does it take?',
      a: "It depends on your computer. With WebGPU (recent Chrome or Edge on a computer with a decent graphics card) a 4-minute song usually takes one to three minutes. Without WebGPU it runs on the processor and can take ten minutes or more. The progress bar shows the time left, and the page stays usable while it works. Phones don't have enough memory for this model, so use a computer.",
    },
    {
      q: 'Can I publish what I make with it?',
      a: "Splitting a song doesn't change who owns it. Personal uses like karaoke at home, practicing along, studying a mix or remixing for yourself are generally fine. To post a cover, remix or sample publicly, you need permission from whoever holds the rights to the original recording.",
    },
    filePrivacyFaq,
  ],
  related: ['audio-cutter', 'audio-noise-reduction', 'audio-to-text', 'voice-recorder'],
  next: ['audio-cutter', 'pitch-changer'],
  flagship: { elsewhere: 'Paid per minute of audio, with uploads and monthly caps', here: 'Unlimited songs, free: the AI runs on your own computer' },
} satisfies Tool;

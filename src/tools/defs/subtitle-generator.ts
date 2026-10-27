import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'subtitle-generator',
  category: 'ai',
  name: 'Auto subtitle generator (SRT)',
  title: 'Auto Subtitle Generator: free AI subtitles (SRT), no upload',
  h1: 'Auto *subtitle* generator',
  description: 'Generate subtitles for any video with Whisper AI in your browser. Fix the text and timing, export SRT or VTT, or burn them in. Free, no watermark, no upload.',
  tagline: 'Whisper AI listens to your video and writes timed, readable subtitles you can edit, export or burn in.',
  keywords: ['subtitle generator', 'auto subtitles', 'generate srt', 'ai subtitles', 'automatic captions', 'video to srt', 'caption generator', 'auto captions for tiktok', 'srt maker'],
  island: 'SubtitleGenerator',
  steps: [
    'Drop in your video and pick the spoken language, or let it detect it. The first time, the AI model downloads once (about 80 MB).',
    'Press Generate and watch the subtitles appear. Play the video, fix any words, nudge times, and split or merge lines.',
    'Download an SRT or VTT file, or burn the subtitles into the video and download it, with no watermark.',
  ],
  faq: [
    { q: 'Which AI model does it use, and what is its license?', a: 'Whisper by OpenAI, released under the MIT license, in the ONNX versions published by the onnx-community on Hugging Face. The standard model is Whisper base (about 80 MB, or 149 MB for the graphics-card version), phones use Whisper tiny (44 MB), and computers with WebGPU can switch to the more accurate Whisper large-v3 turbo (566 MB). It downloads once and then stays in your browser.' },
    { q: 'How are the subtitle lines made?', a: 'Whisper gives a time for every word. The tool groups words into subtitles of up to two lines of 42 characters, shown for 1 to 7 seconds, and starts a new subtitle at pauses and at the end of sentences. For vertical social videos, pick "1 short line" for punchier captions. Word times can be off by a fraction of a second, so play it through and nudge anything that feels early or late.' },
    { q: 'Should I burn the subtitles in or download an SRT?', a: 'Burned-in subtitles are drawn into the picture, so they show everywhere, including Instagram, TikTok and WhatsApp, but they can\'t be turned off. An SRT or VTT file keeps them separate: upload it to YouTube or Vimeo next to the video, and viewers can switch the captions on or off.' },
    { q: 'Is it accurate, and can it translate?', a: "It's AI, so expect to fix a few names and quiet words, and it can't tell speakers apart. Choosing the language helps. Turn on \"Translate into English\" to get English subtitles for speech in another language (standard model only)." },
    filePrivacyFaq,
  ],
  related: ['audio-to-text', 'add-subtitles-to-video', 'trim-video', 'resize-video'],
  next: ['add-subtitles-to-video'],
  flagship: { elsewhere: 'Watermarks, upload caps or paid minutes for auto captions', here: 'Free, no watermark, never uploaded' },
} satisfies Tool;

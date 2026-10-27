import { MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'audio-to-text',
  category: 'ai',
  name: 'Audio & video to text (transcription)',
  title: 'Audio to Text: free AI transcription, no limits, no upload',
  h1: 'Audio & video to *text*',
  description: 'Transcribe audio and video to text with Whisper AI, right in your browser. No minute limits, no sign-up, nothing uploaded. Export TXT, SRT, VTT or JSON.',
  tagline: 'Whisper AI turns speech into a timestamped transcript on your own device, in about 100 languages.',
  keywords: ['transcribe audio to text', 'speech to text', 'video to text', 'mp3 to text', 'transcription', 'whisper ai', 'transcribe interview', 'voice to text', 'free transcription'],
  island: 'Transcriber',
  steps: [
    'Drop in a recording, voice memo, podcast or video (MP3, M4A, WAV, MP4, MOV, WebM and more).',
    'Pick the spoken language or let it detect it, then press Transcribe. The first time, the AI model downloads once (about 80 MB).',
    'Watch the text appear, click a timestamp to hear that part, then copy it or download TXT, SRT, VTT or JSON.',
  ],
  faq: [
    { q: 'Is there a limit on minutes or file size?', a: 'No. There are no minute caps and no file-size cap from us, because the transcription runs on your own device. Long files simply take longer: on a typical laptop the standard model works at about 1–3× real time on the processor, and much faster on a graphics card with WebGPU. Phones are slower, so they start with a smaller model.' },
    { q: 'Which AI model does it use, and what is its license?', a: 'Whisper by OpenAI, released under the MIT license, in the ONNX versions published by the onnx-community on Hugging Face. The standard model is Whisper base (about 80 MB on the processor, 149 MB for the graphics-card version); phones use Whisper tiny (44 MB). On computers with WebGPU you can switch to Whisper large-v3 turbo (566 MB), which is noticeably more accurate. The model downloads once, then stays in your browser.' },
    { q: 'How accurate is it?', a: "On clear speech it gets most words right, but it's AI, so it can mishear names, jargon and quiet or overlapping voices, and it occasionally invents words during long silences or music. Picking the language instead of auto-detect and using the accurate model both help. It doesn't label speakers: it writes down what's said, not who said it." },
    { q: 'Can it translate a recording into English?', a: 'Yes. Turn on "Translate into English" and Whisper writes English text whatever language is spoken. This works with the standard model; the accurate large-v3 turbo model was trained to transcribe only, so it writes the original language.' },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Standard model', effect: 'Whisper base: quick and good on clear speech in about 100 languages. Runs on the graphics card when WebGPU is available, otherwise on the processor.' },
      { name: 'Accurate model', effect: 'Whisper large-v3 turbo: much better with accents, noise and names, but a far bigger download and it needs a capable graphics card, so it\'s offered on computers only.' },
      { name: 'Spoken language', effect: 'Auto-detect, or name the language yourself, which helps with short or mixed clips.' },
      { name: 'Translate to English', effect: 'Writes English text whatever language is spoken. Available with the Standard model.' },
      { name: 'Timestamps', effect: 'Adds a [m:ss] time to each line of the text; SRT and VTT always carry timings for subtitles.' },
    ],
    results: [
      { input: '2-minute recording of a 1962 speech, MP3, 1.8 MB', setting: 'Standard, auto language, on the graphics card', output: '254 words', note: '23.6 s including loading the downloaded model; it misheard one name and one phrase' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'TXT', about: 'Plain text, with or without times.' },
      { name: 'SRT and VTT', about: 'Subtitle files with start and end times, for video players and editors (VTT is the web\'s version).' },
      { name: 'JSON', about: 'Every word with its own start and end time, for developers.' },
    ],
  },
  related: ['subtitle-generator', 'voice-recorder', 'audio-cutter', 'audio-noise-reduction'],
  next: ['text-summarizer', 'translator'],
  flagship: { elsewhere: 'Free plans cap your minutes and upload your audio', here: 'No minute limits, transcribed on your device' },
} satisfies Tool;

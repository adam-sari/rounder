import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'add-subtitles-to-video',
  category: 'video',
  name: 'Add subtitles to video (burn in captions)',
  title: 'Add Subtitles to Video: burn in SRT captions, free, no upload',
  h1: 'Add *subtitles* to video',
  description: 'Burn SRT or VTT subtitles into any video, or write them yourself. Style the captions, preview them live, export SRT/VTT. No watermark, no upload.',
  tagline: 'Load an SRT, paste text or type your own, style the captions and burn them into the video.',
  keywords: ['add subtitles to video', 'burn subtitles into video', 'hardcode subtitles', 'add captions to video', 'srt to video', 'burn in captions', 'subtitle editor', 'vtt to srt'],
  island: 'SubtitleBurner',
  steps: [
    'Drop in your video, plus its .srt or .vtt file if you have one. You can also paste text or add lines while it plays.',
    'Fix the timing and wording in the list, then pick a font, size, color, outline and position. The player previews it live.',
    'Burn the subtitles in and download the video, or download the edited subtitles as SRT or VTT.',
  ],
  faq: [
    { q: 'What does "burn in" mean?', a: 'The words are drawn into the picture itself, so they show up everywhere: Instagram, TikTok, WhatsApp, or any player that ignores subtitle files. The trade-off is that they can\'t be switched off. If you want switchable subtitles, download the SRT or VTT file instead and upload it alongside the video.' },
    { q: 'Which subtitle files work?', a: 'SRT and WebVTT (.vtt). Formatting tags like italics and font colors are removed, and files with Windows line endings, a byte order mark, UTF-16 or the older Western Windows-1252 encoding load fine. You can also paste plain lines with no times: they are spread across the video by length, ready for you to adjust.' },
    { q: 'Can it create subtitles automatically?', a: 'Yes, with the auto subtitle generator: it transcribes the speech with AI on your device and makes an SRT file you can style and burn in here. You can also load a subtitle file, paste a transcript, or add lines as people speak.' },
    { q: 'Will the video lose quality?', a: 'Adding text means every frame is re-encoded. At the default "high" quality the difference is hard to spot, and the sound is kept. The file size can go up or down, and you see both sizes before you download.' },
    filePrivacyFaq,
  ],
  related: ['subtitle-generator', 'trim-video', 'video-compressor', 'crop-video'],
  flagship: { elsewhere: 'Watermarks or upload size limits on free plans', here: 'No watermark, no size cap, never uploaded' },
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'video-to-mp3',
  category: 'video',
  name: 'Extract audio from video (MP3)',
  title: 'Video to MP3 Converter: extract audio from any video, free',
  h1: 'Video to *MP3*',
  description: 'Extract the audio from MP4, MOV, MKV, WebM or AVI videos as MP3, M4A, WAV, OGG or FLAC. Batch convert and trim, with no upload and no size cap.',
  tagline: 'Pull the soundtrack out of any video, one file or a whole batch.',
  keywords: ['video to mp3', 'mp4 to mp3', 'extract audio from video', 'convert video to audio', 'mov to mp3', 'video to wav', 'mp4 to m4a', 'rip audio from video', 'video to audio converter'],
  island: 'VideoToMp3',
  steps: [
    'Drop in one or more videos: MP4, MOV, MKV, WebM, AVI and more.',
    'Pick MP3 or another format and a bitrate. To keep only part of a video, select it and turn on trimming.',
    'Click Extract audio, then download each file or all of them as a zip.',
  ],
  faq: [
    { q: 'Which format should I pick?', a: 'MP3 plays on every phone, car stereo and app. M4A (AAC) sounds as good at a lower bitrate and is at home on Apple devices. OGG uses Opus, the most efficient of the three, but some older players can\'t open it. WAV and FLAC are lossless: pick them for editing, with FLAC at roughly half the size of WAV.' },
    { q: 'What bitrate should I use?', a: '192 kbps MP3 is a safe choice for music and speech, and 128 kbps is plenty for podcasts and voice notes. A higher bitrate than the video\'s own audio can\'t add quality back. "Original" keeps the audio exactly as it is when it already fits the format, for example the AAC audio in most MP4 files saved as M4A, which is instant and lossless.' },
    { q: 'Why does FLAC or AVI ask for a download?', a: 'Browsers have no built-in FLAC encoder and can\'t read some older formats like AVI, WMV or FLV. For those, Rounder offers to fetch a 31 MB open-source decoder (ffmpeg) once. It runs on your device like everything else, so your files still aren\'t uploaded.' },
    { q: 'Is there a limit on file size or number of files?', a: 'No caps from us. Files are read in pieces rather than loaded into memory whole, so long videos work too; they just take longer on slower devices. Add as many videos as you like and download the results as one zip.' },
    filePrivacyFaq,
  ],
  related: ['audio-converter', 'audio-to-text', 'audio-cutter', 'mute-video'],
  flagship: { elsewhere: 'Upload size caps and daily conversion limits', here: 'No size cap, no upload, whole batches at once' },
} satisfies Tool;

import { MEASURED } from '../lib/notes';
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
  notes: {
    settings: [
      { name: 'Audio format', effect: 'MP3 (plays on everything), M4A with AAC (smaller at the same quality, at home on Apple devices), OGG with Opus (most quality per kilobyte), WAV (uncompressed) or FLAC (lossless, about half of WAV).' },
      { name: 'Bitrate', effect: 'MP3 128–320 kbps (default 192), M4A 96–192 (default 160), OGG 64–192 (default 128). Below 160 is fine for speech and podcasts; 160 and up suits music.' },
      { name: '"original" bitrate', effect: 'Copies the sound track out of the video untouched when it already suits the format: AAC into M4A, MP3 into MP3, Opus or Vorbis into OGG. No re-encoding, no quality loss, and far faster.' },
      { name: 'Only keep part of it', effect: 'Drag the handles or type exact times to export just a section.' },
    ],
    results: [
      { input: '1-minute 1080p MP4 with AAC sound, 117 MB', setting: 'MP3, 192 kbps', output: '1.4 MB MP3', note: '2.0 s' },
      { input: '1-minute 1080p MP4 with AAC sound, 117 MB', setting: 'M4A, original', output: '1.4 MB M4A', note: 'copied without re-encoding, 0.2 s' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'MP3', about: 'The safe pick for any player, car stereo or app.' },
      { name: 'M4A (AAC)', about: 'What phones record and stream in; often the original track of an MP4, so it can be copied without any loss.' },
      { name: 'WAV and FLAC', about: 'For editing: WAV is about 10 MB a minute, FLAC roughly half that, both without loss.' },
    ],
  },
  related: ['audio-converter', 'audio-to-text', 'audio-cutter', 'mute-video'],
  next: ['audio-cutter', 'audio-to-text'],
  flagship: { elsewhere: 'Upload size caps and daily conversion limits', here: 'No size cap, no upload, whole batches at once' },
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'audio-cutter',
  category: 'audio',
  name: 'MP3 cutter / audio trimmer',
  title: 'MP3 Cutter & Audio Trimmer: cut songs online, free',
  h1: 'MP3 *cutter*',
  description: 'Trim MP3, M4A, WAV, OGG and FLAC files, or cut parts out of the middle. Add fades, save as MP3, M4A, WAV or OGG. No upload, no size cap.',
  tagline: 'Trim a song, cut out the bits you don\'t want, and fade it in and out.',
  keywords: ['mp3 cutter', 'audio trimmer', 'cut mp3', 'trim audio', 'audio cutter online', 'cut song', 'mp3 trimmer', 'remove part of audio', 'fade in fade out audio'],
  island: 'AudioCutter',
  steps: [
    'Drop in an audio file (MP3, M4A, WAV, OGG, FLAC) or a video to cut its sound.',
    'Drag the handles on the waveform to keep a part, or switch to "remove parts" to cut sections out. Add a fade if you like.',
    'Pick the output format and press Cut audio, then listen to the result and download it.',
  ],
  faq: [
    { q: 'Does cutting an MP3 lower its quality?', a: 'Not if you keep the same format and skip the fades: the audio is copied without re-encoding, so nothing is lost. Fades, joins and format changes need a re-encode, which at the default settings is very hard to hear.' },
    { q: 'Can I remove a part from the middle of a song?', a: 'Yes. Switch to "remove parts", drag the striped cut over what you don\'t want, and add more cuts if needed. The remaining pieces are joined with a few milliseconds of crossfade so you don\'t hear a click.' },
    { q: 'How do I set an exact start or end time?', a: 'Type it into the start and end boxes, like 1:23.5, or move the playhead and press "in" or "out". The arrow keys nudge a focused handle by 10 ms, and Shift+arrow by a full second. Ctrl or ⌘ plus the mouse wheel zooms the waveform.' },
    { q: 'Which formats can I open?', a: 'Anything your browser can play, which covers MP3, M4A/AAC, WAV, OGG, Opus and FLAC, plus the sound from MP4, MOV and WebM videos. Rarer formats such as WMA or AMR can be opened with a one-time decoder download.' },
    filePrivacyFaq,
  ],
  related: ['ringtone-maker', 'audio-joiner', 'audio-converter', 'trim-video'],
} satisfies Tool;

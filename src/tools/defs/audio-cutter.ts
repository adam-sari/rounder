import { MEASURED } from '../lib/notes';
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
  notes: {
    settings: [
      { name: 'Keep selection / remove parts', effect: 'Keep one stretch between the handles, or stripe out any number of sections; the remaining pieces are joined with a crossfade of a few milliseconds so the joins don\'t click.' },
      { name: 'Fade in and out', effect: 'Ramps the volume at the start and end. Fades mean re-encoding, so the "same format" copy no longer applies.' },
      { name: 'Output format', effect: '"same" (when the source format can be written back) cuts without re-encoding if you keep one part and add no fades: no quality loss, though the cut snaps to the nearest audio frame and can start up to a fifth of a second early. MP3 128/192/320 kbps, M4A 128/160/192, OGG 96/128/192 (the middle one is the default), or WAV.' },
    ],
    results: [
      { input: '70-second song, MP3 320 kbps, 2.7 MB', setting: 'Keep 0:10–0:40, same (MP3)', output: '1.1 MB MP3', note: 'copied at 320 kbps without re-encoding, 0.1 s' },
      { input: '70-second song, MP3 320 kbps, 2.7 MB', setting: 'Keep 0:10–0:40, MP3 192 kbps', output: '705 KB MP3', note: '30 seconds of audio, 3.5 s' },
      { input: '70-second song, MP3 320 kbps, 2.7 MB', setting: 'Keep 0:10–0:40, WAV', output: '5.0 MB WAV', note: 'uncompressed, 1.4 s' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'Same format', about: 'The fastest and lossless route: the original frames are copied, so an MP3 stays exactly as good as it was.' },
      { name: 'MP3, M4A, OGG', about: 'Re-encoded at the bitrate you pick: needed for fades, joins and format changes.' },
      { name: 'WAV', about: 'Uncompressed, for editing further; about 10 MB a minute.' },
    ],
  },
  related: ['ringtone-maker', 'audio-joiner', 'audio-converter', 'trim-video'],
  next: ['audio-normalizer', 'audio-joiner'],
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'audio-joiner',
  category: 'audio',
  name: 'Audio joiner / merge MP3',
  title: 'Audio Joiner: Merge MP3 & Audio Files with Crossfade, Free',
  h1: 'Audio *joiner*',
  description: 'Merge MP3, WAV, M4A and other audio files into one. Reorder, trim, crossfade and level each track. No upload, no sign-up, no file size limit.',
  tagline: 'Put songs, clips and voice notes in order and join them into one file.',
  keywords: ['merge mp3', 'join mp3 files', 'combine audio files', 'audio merger', 'merge audio online', 'mp3 joiner', 'crossfade songs', 'combine songs into one'],
  island: 'AudioJoiner',
  steps: [
    'Drop in your audio files, or videos whose sound you want. Drag them into the order you like.',
    'Trim or turn up any track, then choose a crossfade or a pause between tracks.',
    'Pick MP3, M4A, OGG, WAV or FLAC and join. Listen to the result, then download it.',
  ],
  faq: [
    {
      q: 'Can I join files in different formats?',
      a: 'Yes. Mix MP3, WAV, M4A, FLAC and OGG, or take the sound from MP4, MOV and WebM videos. Tracks with different sample rates are converted to the highest one (up to 48 kHz), and mono tracks play in both speakers if anything else is stereo. Formats your browser can\'t play by itself, such as WMA, can be converted with an optional one-time decoder download.',
    },
    {
      q: 'How does the crossfade work?',
      a: 'The end of each track overlaps the start of the next, one fading out while the other fades in. The fades use equal-power curves, so the volume stays steady instead of dipping in the middle. A crossfade is never longer than half of the shorter track, so short clips aren\'t swallowed. Choose Silence instead to put a pause between tracks.',
    },
    {
      q: 'What does "Match loudness" do?',
      a: 'It measures how loud each track sounds, in LUFS (the same measure streaming services use), and turns each one up or down to about −16 LUFS so a quiet recording doesn\'t sit next to a blaring one. It never pushes a track\'s peaks above −1 dB, and if overlapping tracks would clip, the whole mix is lowered slightly instead.',
    },
    {
      q: 'Is there a limit on files or length?',
      a: 'No file cap and no size cap from us. The joined audio is built in your browser\'s memory, though, so past about an hour some browsers and phones run out of room. The tool warns you before that, and joining in smaller batches always works.',
    },
    filePrivacyFaq,
  ],
  related: ['audio-cutter', 'audio-converter', 'audio-normalizer', 'merge-videos'],
  flagship: { elsewhere: 'Upload first, with file-size caps', here: 'Joined on your device, no size cap' },
} satisfies Tool;

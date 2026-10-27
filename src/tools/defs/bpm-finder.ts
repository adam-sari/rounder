import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'bpm-finder',
  category: 'audio',
  name: 'BPM & key finder',
  title: 'BPM & Key Finder: detect a song’s tempo and key, free',
  h1: 'BPM & key *finder*',
  description: 'Find the BPM and musical key of any song, with Camelot codes for DJs, beat markers and a tap tempo pad. Analyze a batch and export CSV. No upload.',
  tagline: 'Drop in a song to get its tempo, key and Camelot code, or just tap along.',
  keywords: ['bpm finder', 'bpm detector', 'song key finder', 'tempo finder', 'tap tempo', 'camelot key finder', 'find bpm of a song', 'key detector', 'what key is this song in'],
  island: 'BpmFinder',
  steps: [
    'Drop in one or more songs: MP3, WAV, M4A, FLAC, OGG, or a video with music in it.',
    'Wait a few seconds while it listens. You get the BPM, the key with its Camelot code, and the beats marked on the waveform.',
    'Play it with the click track to check the beat, or tap along on the pad. For a batch, sort the table and export a CSV.',
  ],
  faq: [
    {
      q: 'How accurate is it?',
      a: 'It does best on music with a steady beat, like electronic, pop, hip-hop and rock. Songs that speed up and slow down get an average tempo. The most common slip is half or double time (87 instead of 174), so both are listed next to the result, and the click track and tap pad let you check by ear.',
    },
    {
      q: 'What does the Camelot code mean?',
      a: 'The Camelot wheel numbers the 24 keys from 1 to 12, with A for minor and B for major. Songs with the same code, or one step apart on the same letter, or the same number with the other letter, usually mix together smoothly. C major is 8B and A minor is 8A.',
    },
    {
      q: 'Why does it show a relative major or minor?',
      a: 'A major key and its relative minor use exactly the same notes, like C major and A minor. They differ only in which note feels like home, so they are the classic mix-up for any key detector, this one included. If the song seems to settle on the other one, trust your ears.',
    },
    {
      q: 'Can I analyze a whole playlist?',
      a: 'Yes. Drop in as many files as you like. They are analyzed one after another into a table you can sort by BPM or Camelot code, then export as a CSV for a spreadsheet or your DJ prep.',
    },
    filePrivacyFaq,
  ],
  related: ['metronome', 'online-tuner', 'audio-speed-changer', 'pitch-changer'],
} satisfies Tool;

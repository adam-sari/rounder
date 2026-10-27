import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'ringtone-maker',
  category: 'audio',
  name: 'Ringtone maker',
  title: 'Ringtone Maker: make iPhone (M4R) & Android ringtones free',
  h1: 'Ringtone *maker*',
  description: 'Turn any song into a ringtone: pick the best 30 seconds, add a fade, and save an iPhone .m4r or Android MP3. Free, no upload, no sign-up.',
  tagline: 'Pick the best bit of a song and save it as an iPhone or Android ringtone.',
  keywords: ['ringtone maker', 'make ringtone', 'iphone ringtone', 'm4r converter', 'mp3 to m4r', 'android ringtone', 'custom ringtone', 'ringtone cutter', 'song to ringtone'],
  island: 'RingtoneMaker',
  steps: [
    'Drop in a song. The loudest 30 seconds, which is often the chorus, is selected for you.',
    'Drag the selection to the part you want, up to 40 seconds, and adjust the fade in and out.',
    'Choose iPhone (.m4r) or Android (.mp3), press Make ringtone, download it and follow the short install steps.',
  ],
  faq: [
    { q: 'How long can a ringtone be?', a: 'iPhone ringtones can be up to 40 seconds, so the selection stops there. About 30 seconds is plenty for a phone call. Android has no strict limit, but a short clip is easier to recognize.' },
    { q: 'What is an M4R file?', a: 'It\'s the ringtone format iPhones use: AAC audio in an MPEG-4 file, the same as an M4A, with the .m4r extension so iPhone treats it as a ringtone.' },
    { q: 'How do I put the ringtone on my iPhone?', a: 'Connect your iPhone to a Mac and drag the .m4r onto it in Finder, or use iTunes on Windows and drop it into Tones. Without a computer, you can import an MP3 into GarageBand on the iPhone and share it as a ringtone from there. Then choose it in Settings › Sounds & Haptics › Ringtone.' },
    { q: 'Does it work with songs from Apple Music or Spotify?', a: 'No. Streaming songs are protected and aren\'t files you can open. It works with audio files you own, such as MP3s, voice memos and recordings.' },
    filePrivacyFaq,
  ],
  related: ['audio-cutter', 'audio-converter', 'm4a-to-mp3', 'audio-normalizer'],
} satisfies Tool;

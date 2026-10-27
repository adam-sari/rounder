import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'audio-normalizer',
  category: 'audio',
  name: 'Audio normalizer',
  title: 'Audio Normalizer: LUFS loudness for Spotify, YouTube, podcasts',
  h1: 'Audio *normalizer*',
  description: 'Measure loudness in LUFS and normalize audio or video to −14 LUFS for Spotify and YouTube, −16 for podcasts or −23 for broadcast. Batch, no upload.',
  tagline: 'Measure LUFS and true peak, then bring a whole batch to the same loudness.',
  keywords: ['normalize audio', 'lufs meter', 'loudness normalization', 'normalize mp3', '-14 lufs', 'podcast loudness', 'ebu r128', 'normalize volume of multiple files', 'true peak'],
  island: 'AudioNormalizer',
  steps: [
    'Drop in one file or a whole batch: songs, podcast episodes or videos. Each one is measured in LUFS as it arrives.',
    'Pick a target such as Spotify / YouTube (−14 LUFS) or Podcast, and check the planned gain for each file.',
    'Press Normalize, compare before and after, then download the files one by one or as a zip.',
  ],
  faq: [
    {
      q: 'What is LUFS?',
      a: 'LUFS (loudness units relative to full scale) measures how loud audio sounds to people, not just how high its peaks reach. This tool measures integrated loudness as described in ITU-R BS.1770 and EBU R128, including the gating that ignores silence and quiet passages, and also reports true peak and loudness range.',
    },
    {
      q: 'Which target should I pick?',
      a: 'Spotify and YouTube play music at around −14 LUFS, so louder files get turned down anyway. Apple Music aims for about −16 LUFS. Podcasts commonly use −16 LUFS for stereo and −19 for mono. European broadcast follows EBU R128 at −23 LUFS.',
    },
    {
      q: 'What does the limiter do?',
      a: 'Raising a file to the target can push its peaks above the ceiling (−1 dBTP by default). The limiter turns just those peaks down, watching true peaks with 4× oversampling, so the file gets to (or very close to) the target without clipping. Heavy limiting can leave a file slightly under the target; the after figure shows where each one landed. With the limiter off, those files are raised only as far as their peaks allow.',
    },
    {
      q: 'How is this different from peak normalizing?',
      a: 'Peak normalizing sets the loudest sample to a level such as −1 dBFS. It is quick, but two files peaked to the same level can still sound very different. LUFS normalizing matches how loud they sound. Both are available here.',
    },
    filePrivacyFaq,
  ],
  related: ['volume-booster', 'audio-converter', 'audio-joiner', 'audio-noise-reduction'],
  flagship: { elsewhere: 'Monthly processing-hour limits on free plans', here: 'Unlimited files, measured on your device' },
} satisfies Tool;

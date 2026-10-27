import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'volume-booster',
  category: 'audio',
  name: 'Volume booster',
  title: 'Volume Booster: make audio and video louder online, free',
  h1: 'Volume *booster*',
  description: 'Make quiet audio and videos louder by up to 30 dB. Hear the boost live, and a true-peak limiter keeps the export from clipping. No upload, no watermark.',
  tagline: 'Turn up quiet recordings, songs and videos without the crackle of clipping.',
  keywords: ['make audio louder', 'volume booster', 'increase mp3 volume', 'make video louder', 'boost audio volume', 'amplify audio', 'increase audio volume online', 'louder mp3'],
  island: 'VolumeBooster',
  steps: [
    'Drop in an audio or video file: MP3, WAV, M4A, MP4, MOV and more.',
    'Drag the boost slider and press play to hear it live. The meter and waveform show where peaks would clip.',
    'Pick a format and export. Videos keep their picture; only the sound is re-encoded.',
  ],
  faq: [
    {
      q: 'Will boosting make my audio distort?',
      a: 'Not from clipping. When the boost pushes peaks past full scale, a look-ahead limiter turns just those peaks down so they stay under −1 dB true peak. Very big boosts can still sound flat or pumpy, and any background noise gets louder along with everything else.',
    },
    {
      q: 'How much louder can I make it?',
      a: 'Up to +30 dB. As a rule of thumb, every +10 dB sounds about twice as loud. The "loudest clean" button picks the biggest boost that needs no limiting at all.',
    },
    {
      q: 'Can I make a video louder?',
      a: 'Yes. Drop in an MP4, MOV, WebM or MKV and the boosted soundtrack goes back into the same video. The picture is copied as is, so it keeps its quality and the export is quick. You can also save just the audio as MP3, WAV, M4A, OGG or FLAC.',
    },
    {
      q: 'Can I turn audio down instead?',
      a: 'Yes. The slider goes down to −20 dB, which is handy for a clip that is too loud next to the rest of your project.',
    },
    filePrivacyFaq,
  ],
  related: ['audio-normalizer', 'audio-converter', 'mute-video', 'audio-cutter'],
  flagship: { elsewhere: 'Upload caps, or a watermark on free video exports', here: 'No size cap, no watermark, nothing uploaded' },
} satisfies Tool;

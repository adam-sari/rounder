import { LIMITS, MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'gif-to-mp4',
  category: 'video',
  name: 'GIF to MP4',
  title: 'GIF to MP4 Converter: shrink animated GIFs in bulk, free',
  h1: 'GIF to *MP4*',
  description: 'Convert animated GIFs to MP4 or WebM videos that are usually a fraction of the size. Batch convert, repeat loops, pick a background. Nothing uploaded.',
  tagline: 'Turn heavy GIFs into small, smooth videos, a whole batch at once.',
  keywords: ['gif to mp4', 'convert gif to video', 'gif to webm', 'gif to mp4 converter', 'gif to video for instagram', 'reduce gif size', 'batch gif to mp4', 'animated gif to video'],
  island: 'GifToMp4',
  steps: [
    'Drop in one animated GIF or a whole batch.',
    'Choose MP4 or WebM, how many times each GIF plays in the video, and a background color for any transparent areas.',
    'Convert, compare the GIF and the video side by side, then download each file or all of them as a zip.',
  ],
  faq: [
    {
      q: 'How much smaller will the video be?',
      a: 'Usually a lot. Animated GIFs often shrink by 80% or more as MP4, because video codecs store only what changes between frames and aren\'t limited to 256 colors. Tiny or very simple GIFs save less, and the tool shows the exact result for every file.',
    },
    {
      q: 'Why would I repeat the GIF inside the video?',
      a: 'A GIF loops on its own, but a video plays once unless the site or player loops it. Repeating the animation makes short clips last longer, and the "≥ 3 s" option repeats a short GIF until the video is at least three seconds long, since some sites reject very short videos.',
    },
    {
      q: 'What happens to transparent areas?',
      a: 'The MP4 and WebM files made here can\'t be see-through, so transparent pixels are filled with a solid color. Black is the default; white or any color you pick works too.',
    },
    {
      q: 'Should I pick MP4 or WebM?',
      a: 'MP4 (H.264) plays on practically every phone, computer, browser and app, so it\'s the safe choice. WebM (VP9) is often a little smaller at the same quality and plays in all modern browsers, but some apps and older devices can\'t open it.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Convert to', effect: 'MP4 with H.264, which plays on every phone, browser and app, or WebM with VP9, smaller and at home in browsers and on Android.' },
      { name: 'Play the GIF', effect: '1×, 2×, 3× or 5× in a row, or "≥ 3 s", which repeats a short GIF until the video lasts at least 3 seconds. Most players can also loop the video themselves.' },
      { name: 'Background', effect: 'Video has no transparency, so see-through pixels become black (default), white or a color you pick.' },
      { name: 'Quality', effect: 'Smaller, balanced (default) or sharpest: how many bits the video gets per frame.' },
    ],
    results: [{ input: '5-second 480×270 GIF, 60 frames, 2.3 MB', setting: 'MP4, balanced', output: '628 KB MP4', note: '73% smaller, 0.9–1.5 s' }],
    measured: MEASURED,
    formats: [
      { name: 'GIF', about: 'A 1987 image format: at most 256 colors per frame and weak compression, which is why animated GIFs get so heavy.' },
      { name: 'MP4 and WebM', about: 'Modern video codecs: full color and much stronger compression than GIF.' },
    ],
    limits: [LIMITS.discord, LIMITS.gmail],
  },
  related: ['video-to-gif', 'video-compressor', 'video-converter', 'image-compressor'],
  next: ['video-compressor'],
  flagship: { elsewhere: 'One GIF at a time, uploaded to a server', here: 'Whole batches, converted on your device' },
} satisfies Tool;

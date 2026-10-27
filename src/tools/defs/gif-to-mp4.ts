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
  related: ['video-to-gif', 'video-compressor', 'video-converter', 'image-compressor'],
  next: ['video-compressor'],
  flagship: { elsewhere: 'One GIF at a time, uploaded to a server', here: 'Whole batches, converted on your device' },
} satisfies Tool;

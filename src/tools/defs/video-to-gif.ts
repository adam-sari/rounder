import { LIMITS, MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'video-to-gif',
  category: 'video',
  name: 'Video to GIF',
  title: 'Video to GIF Converter: trim, caption & loop, no watermark',
  h1: 'Video to *GIF*',
  description: 'Turn any clip into a GIF in your browser. Pick the exact range, size and frame rate, add a caption and preview it live. No upload, no watermark.',
  tagline: 'Pick the moment, add a caption, and get a crisp GIF or a tiny looping MP4.',
  keywords: ['video to gif', 'mp4 to gif', 'gif maker', 'make a gif from a video', 'mov to gif', 'webm to gif', 'gif with text', 'screen recording to gif'],
  island: 'VideoToGif',
  steps: [
    'Drop in a video: MP4, MOV, WebM, MKV and more.',
    'Drag the timeline handles to pick the part you want, then set the width, frame rate, colors and an optional caption. The preview and size estimate update as you go.',
    'Click Make GIF and download it, or make a much smaller MP4 or WebM loop instead.',
  ],
  faq: [
    {
      q: 'Why are GIFs so big?',
      a: 'GIF is a format from 1987. Each frame can only hold 256 colors and is compressed on its own, without the motion tricks modern video uses. A few seconds of video can easily become several megabytes. This tool keeps GIFs leaner by storing only the pixels that change from one frame to the next.',
    },
    {
      q: 'How do I make my GIF smaller?',
      a: 'Pick a shorter range, a smaller width or a lower frame rate. Those three matter most. Fewer colors and dithering set to off help too. The size estimate updates as you change each setting, so you can see the effect before you make the GIF.',
    },
    {
      q: 'Should I make a GIF or an MP4?',
      a: 'A GIF plays almost anywhere, including emails, docs and old chat apps. An MP4 or WebM loop is usually many times smaller and looks better, and many sites that show "GIFs" actually convert them to video behind the scenes. Use MP4 wherever the site accepts video.',
    },
    {
      q: 'Which video formats can I use?',
      a: 'MP4, MOV, WebM and MKV open straight away in most browsers. Older formats like AVI, WMV and FLV need a one-time decoder download of about 31 MB. The tool asks before fetching it, and it still runs entirely on your device.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Range', effect: 'Starts as the first 5 seconds; drag the handles or type a length. Past 15 seconds the tool warns that the GIF will be big.' },
      { name: 'Width and frame rate', effect: '240–800 px wide (default 480, never wider than the video) and 5–30 frames a second (default 12). Lowering either cuts the file size.' },
      { name: 'Speed', effect: '0.5× to 3×. Faster playback packs more action into fewer frames.' },
      { name: 'Colors and dithering', effect: 'A GIF frame holds at most 256 colors: 256, 128, 64 or 32 per frame. Dithering (pattern or smooth) hides banding in gradients but adds noise that can make the file bigger.' },
      { name: 'Loop and caption', effect: 'Play forever, once or 3 times; optional caption text at the top or bottom.' },
      { name: 'MP4 or WebM instead', effect: 'Makes a "GIF-like" short video: same range, size and speed, at a fraction of the bytes, for places that autoplay video.' },
    ],
    results: [
      { input: '1080p phone-style clip, 42 MB', setting: 'Defaults: first 5 s, 480 px, 12 fps, 256 colors', output: '480×270 GIF, 2.3 MB', note: '60 frames, 4.0 s' },
      { input: 'That 2.3 MB GIF', setting: 'GIF to MP4, balanced', output: '628 KB MP4', note: '73% smaller, same frames' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'GIF', about: 'Plays anywhere, including email and old chat apps, but it stores up to 256 colors per frame and compresses poorly, so a few seconds of real footage runs into megabytes.' },
      { name: 'MP4 and WebM', about: 'Proper video codecs: full color and far smaller.' },
    ],
    limits: [LIMITS.discord, LIMITS.gmail],
  },
  related: ['gif-to-mp4', 'trim-video', 'video-frame-extractor', 'meme-generator'],
  flagship: { elsewhere: 'Upload size caps, watermarks or a sign-up', here: 'Any length, no watermark, nothing uploaded' },
} satisfies Tool;

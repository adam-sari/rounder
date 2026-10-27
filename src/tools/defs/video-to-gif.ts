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
  related: ['gif-to-mp4', 'trim-video', 'video-frame-extractor', 'meme-generator'],
  flagship: { elsewhere: 'Upload size caps, watermarks or a sign-up', here: 'Any length, no watermark, nothing uploaded' },
} satisfies Tool;

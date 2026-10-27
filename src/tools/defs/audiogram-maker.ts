import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'audiogram-maker',
  category: 'audio',
  name: 'Audio to video / waveform video maker',
  title: 'Audiogram Maker: audio to video with waveform, free MP4',
  h1: 'Audiogram *maker*',
  description: 'Turn a podcast clip or song into a shareable video with an animated waveform, title, cover art and captions. Square, 9:16, 16:9 or 4:5. No watermark.',
  tagline: 'Audio in, a moving waveform video out, sized for Reels, Shorts, YouTube or your feed.',
  keywords: ['audiogram maker', 'audio to video', 'mp3 to mp4', 'waveform video', 'podcast video', 'sound wave video', 'audio visualizer', 'music visualizer', 'podcast clip'],
  island: 'AudiogramMaker',
  steps: [
    'Drop in an audio file (MP3, WAV, M4A, FLAC, OGG) or a video with sound, and drag the handles to pick up to 10 minutes.',
    'Choose a shape and visualizer style, set the colors or a background image, and add a title, cover art and captions if you like. Press play to watch the live preview.',
    'Press Make video and download the MP4 or WebM when it is done.',
  ],
  faq: [
    {
      q: 'What is an audiogram?',
      a: 'A short video made from audio: a still design with an animated waveform or spectrum that moves with the sound. Most social apps only take video posts, so podcasters and musicians use audiograms to share clips on Instagram, TikTok, YouTube, X and LinkedIn.',
    },
    {
      q: 'How do I add captions?',
      a: 'Add an .srt or .vtt subtitle file. By default its times are read against the full recording, so a transcript of the whole episode lines up with whichever section you pick. If the file was made just for the clip, tick "Times count from the start of this section".',
    },
    {
      q: 'How long can the video be?',
      a: 'Up to 10 minutes per video. Most social clips are 30 to 90 seconds. The video is drawn frame by frame on your device, so longer sections and 1080p take longer than short ones at 720p.',
    },
    {
      q: 'Does the waveform really follow my audio?',
      a: 'Yes. The tool analyses the sound of your section frame by frame (a frequency spectrum for every video frame), so the bars, wave, line or circle move with the actual audio, both in the preview and in the finished video.',
    },
    filePrivacyFaq,
  ],
  related: ['video-to-mp3', 'audio-cutter', 'add-audio-to-video', 'slideshow-maker'],
  flagship: { elsewhere: 'Watermarks, upload queues or a paid plan to export', here: 'No watermark, 1080p, nothing uploaded' },
} satisfies Tool;

import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'slideshow-maker',
  category: 'video',
  name: 'Photo slideshow maker',
  title: 'Photo Slideshow Maker with Music: free MP4, no watermark',
  h1: 'Photo *slideshow* maker',
  description: 'Turn photos into a video slideshow with music, fades and a slow Ken Burns zoom. 16:9, 9:16, square or 4:5 up to 1080p. No watermark, nothing uploaded.',
  tagline: 'Photos and a song in, a smooth MP4 out, sized for YouTube, Reels or your feed.',
  keywords: ['slideshow maker', 'photo slideshow', 'slideshow with music', 'photos to video', 'pictures to video', 'image to video', 'ken burns', 'instagram slideshow', 'tiktok slideshow'],
  island: 'SlideshowMaker',
  steps: [
    'Drop in your photos (JPG, PNG, WebP or HEIC) and drag them into order.',
    'Pick a shape, transition and how long each photo shows. Add a title card and a song if you like, and press play to preview.',
    'Press Make video and download the MP4 or WebM when it is done.',
  ],
  faq: [
    {
      q: 'Can the slideshow match the length of my song?',
      a: 'Yes. Add music, trim it to the part you want, and tick "Fit the slides to the music". The photos then share the song\'s length, and any photo you gave its own duration keeps it. Without that option, the music is cut and faded out where the photos end.',
    },
    {
      q: 'What happens to photos that are a different shape from the video?',
      a: 'You choose. "Fit + blur" shows the whole photo over a soft, blurred copy of itself, "Fit" shows the whole photo with bars in a color you pick, and "Fill" crops the edges so the photo fills the frame.',
    },
    {
      q: 'Which transitions are there?',
      a: 'Fade (a crossfade), Slide (the next photo pushes the last one aside) and Cut (no transition). The optional Ken Burns effect adds a slow zoom to every photo.',
    },
    {
      q: 'Is there a limit on photos or length?',
      a: 'No photo limit and no length limit. Everything runs on your device, so long 1080p slideshows simply take longer to render. If a phone runs out of memory, try 720p.',
    },
    filePrivacyFaq,
  ],
  related: ['merge-videos', 'add-audio-to-video', 'audio-cutter', 'social-media-image-resizer'],
  flagship: { elsewhere: 'Watermarks or a paid plan for HD', here: 'No watermark, 1080p, nothing uploaded' },
} satisfies Tool;

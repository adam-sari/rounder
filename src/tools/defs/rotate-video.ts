import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'rotate-video',
  category: 'video',
  name: 'Rotate & flip video',
  title: 'Rotate Video Online: fix sideways videos, flip & mirror, free',
  h1: 'Rotate & flip *video*',
  description: 'Rotate a sideways or upside-down video 90°, 180° or 270°, or mirror it. The turn is saved into the picture, so it plays right everywhere.',
  tagline: 'Turn a sideways clip the right way up, and keep it that way in every player.',
  keywords: ['rotate video', 'rotate video 90 degrees', 'flip video', 'mirror video', 'fix sideways video', 'rotate mp4', 'rotate iphone video', 'flip video horizontally'],
  island: 'RotateVideo',
  steps: [
    'Drop in your video: MP4, MOV, WebM, MKV and most other formats.',
    'Turn it left or right, or flip it, and check the live preview.',
    'Save it and download the rotated video, with no watermark.',
  ],
  faq: [
    {
      q: 'Why does my video play sideways in some apps but not others?',
      a: 'Phones often record in the sensor\'s orientation and add a rotation tag that tells players which way is up. Most players follow the tag, but some apps and older editors ignore it. This tool turns the picture itself, so the result looks the same in every player. If your video has such a tag, you can save it without other changes to bake the tag in.',
    },
    {
      q: 'Does rotating lower the quality?',
      a: 'Turning the picture means re-encoding the video, which is done at a high quality setting, so the difference is very hard to see. The file size can come out a little larger or smaller than the original. The sound is kept as it is unless the format you save to needs a different audio codec.',
    },
    {
      q: 'What\'s the difference between flipping and rotating?',
      a: 'Rotating turns the picture a quarter or half turn, like turning a photo on a table. Flipping mirrors it, so left becomes right (horizontal) or top becomes bottom (vertical). Mirroring is handy for selfie-camera clips where text reads backwards.',
    },
    {
      q: 'Is there a file size or length limit?',
      a: 'Not from us. The video is processed on your own device, so the only limits are its memory and speed. Long 4K clips can take a while, and the progress bar shows how long is left.',
    },
    filePrivacyFaq,
  ],
  related: ['crop-video', 'video-converter', 'resize-video', 'trim-video'],
  flagship: { elsewhere: 'Watermarks and upload size caps on free plans', here: 'No watermark, no size cap, no upload' },
} satisfies Tool;

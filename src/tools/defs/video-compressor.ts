import { LIMITS, MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'video-compressor',
  category: 'video',
  name: 'Video compressor',
  title: 'Video Compressor: shrink MP4 to any size, no upload',
  h1: 'Video *compressor*',
  description: 'Compress MP4, MOV, WebM and more to a target size like 10 MB for Discord, or by quality. No upload, no watermark and no file-size cap.',
  tagline: 'Shrink videos to fit Discord, email or anywhere else, right on your device.',
  keywords: ['compress video', 'reduce video size', 'compress mp4', 'compress video for discord', 'compress video to 10mb', 'make video smaller', 'shrink video file', 'compress mov'],
  island: 'VideoCompressor',
  steps: [
    'Drop in one video or a whole batch (MP4, MOV, WebM, MKV, AVI and more).',
    'Pick a target size like 10 MB for Discord, or a quality level, and check the size estimate.',
    'Compress, compare the result with the original, and download.',
  ],
  faq: [
    { q: 'How do I get a video under 10 MB for Discord?', a: 'Choose "Target size" and the 10 MB preset. The tool works out the bitrate that fits, and on "Auto" it lowers the resolution when the budget is too thin to keep full size sharp. Long videos may still need trimming first: an hour of video in 10 MB will not look good at any resolution.' },
    { q: 'Which codec should I pick?', a: 'H.264 plays on practically everything, so it is the safe default. HEVC, AV1 and VP9 make smaller files at the same quality, but some phones, TVs and apps cannot play them. Only the codecs your browser can encode are offered.' },
    { q: 'Is there a file-size limit?', a: 'Not from us. The video is processed on your device, so the only limits are your computer\'s memory and disk space. Very large results are written to your browser\'s private storage rather than kept in memory.' },
    { q: 'What if the compressed video comes out bigger?', a: 'Then you get the original back, untouched, and the tool tells you so. That can happen with videos that are already heavily compressed.' },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Target size', effect: '10 MB (Discord), 20 MB (email), 50 MB or any size. The bitrate is worked out from the length so the file lands at or under it, counting 1 MB as 1,000,000 bytes like upload limits do. If a result still comes out over, "Try again, aiming lower" retries.' },
      { name: 'Quality', effect: 'High, Balanced or Smallest, for when no size limit matters. Each also stays well below what the original already spends, so a lean clip doesn\'t grow.' },
      { name: 'Resolution (Auto)', effect: 'In target mode, Auto drops to 720p, 540p or lower when the size budget is too thin for sharp 1080p; or pick 1080p, 720p or 480p yourself. It never upscales.' },
      { name: 'Frame rate cap', effect: 'Original, 30 or 24 fps. Fewer frames leave more bits for each one.' },
      { name: 'Codec', effect: 'H.264 in MP4 (default) plays everywhere. HEVC, AV1 and VP9 are smaller at the same quality, and only offered when your browser can encode them.' },
      { name: 'Remove audio', effect: 'Drops the sound track and gives its share of the budget to the picture.' },
    ],
    results: [
      { input: '23-second 1080p phone-style clip, 42 MB', setting: 'Target 10 MB', output: '7.2 MB at 1080p', note: '8.1 s' },
      { input: '23-second 1080p clip, 42 MB', setting: 'Target 20 MB', output: '14 MB at 1080p', note: '8.1 s' },
      { input: '1-minute 1080p clip, 117 MB', setting: 'Target 10 MB', output: '9.1 MB at 720p', note: 'Auto chose 720p, 8.8 s' },
      { input: '1-minute 1080p clip, 117 MB', setting: 'Target 20 MB', output: '19 MB at 720p', note: '7.1 s' },
      { input: '1-minute 1080p clip, 117 MB', setting: 'Quality: Balanced', output: '12 MB at 1080p', note: '24 s' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'MP4 (H.264)', about: 'Plays on every phone, TV, browser and chat app, which is why it\'s the default.' },
      { name: 'MP4 (HEVC or AV1)', about: 'Smaller files for the same look; some older PCs, browsers and TVs can\'t play them.' },
      { name: 'WebM (VP9)', about: 'Smaller than H.264 and at home in browsers and on Android; not every Apple app opens it.' },
    ],
    limits: [LIMITS.discord, LIMITS.gmail, LIMITS.outlook, LIMITS.yahoo],
  },
  related: ['trim-video', 'resize-video', 'video-converter', 'video-to-gif'],
  flagship: { elsewhere: '100–500 MB caps or a watermark', here: 'Any size, no watermark' },
} satisfies Tool;

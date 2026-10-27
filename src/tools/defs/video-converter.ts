import { filePrivacyFaq, type Tool } from '../types';

type Copy = Pick<Tool, 'title' | 'description' | 'tagline' | 'keywords' | 'steps' | 'faq' | 'related' | 'flagship'>;

const label = (f: string) => (f === 'webm' ? 'WebM' : f.toUpperCase());

/** a /from-to-to page that opens the converter preset to that pair */
function variant(from: string, to: 'mp4' | 'webm', copy: Copy): Tool {
  return {
    slug: `${from}-to-${to}`,
    category: 'video',
    name: `${label(from)} to ${label(to)}`,
    h1: `${label(from)} to *${label(to)}*`,
    island: 'VideoConverter',
    props: { from, to },
    variantOf: 'video-converter',
    ...copy,
    faq: [...copy.faq, filePrivacyFaq],
  };
}

export default [
  {
    slug: 'video-converter',
    category: 'video',
    name: 'Video converter',
    title: 'Video Converter: MP4, WebM, MOV, MKV & AVI, free, no upload',
    h1: 'Video *converter*',
    description: 'Convert videos between MP4, WebM, MOV and MKV, or save the sound as MP3. Runs in your browser: no upload, no watermark, no file-size cap.',
    tagline: 'Turn any video into MP4, WebM, MOV or MKV, or keep just the sound.',
    keywords: ['convert video', 'video format converter', 'convert video to mp4', 'mp4 converter', 'webm converter', 'mov converter', 'mkv converter', 'video to mp3', 'free video converter no watermark'],
    island: 'VideoConverter',
    props: { to: 'mp4' },
    steps: [
      'Drop in a video: MP4, MOV, WebM, MKV, AVI and most other formats work.',
      'Pick the format to convert to. Change the codec, quality or resolution if you like, or keep the defaults.',
      'Press Convert, watch the preview, and download the new file.',
    ],
    faq: [
      { q: 'Which format should I choose?', a: 'MP4 with H.264 plays on almost every phone, computer, TV and website, so it\'s the safe choice. WebM suits web pages. MOV is handy for Apple apps, and MKV for media players like VLC. Pick MP3, M4A or WAV to keep only the sound.' },
      { q: 'Why are some conversions almost instant?', a: 'When the video and audio inside your file already suit the new format, they are copied across without being re-encoded. That takes seconds and loses no quality. The panel shows a "fast copy" badge when this will happen. Otherwise every frame is re-encoded, which takes longer.' },
      { q: 'Which files can it open?', a: 'Anything your browser can decode opens straight away, which covers MP4, MOV, WebM and MKV in most cases. Older formats like AVI, WMV and FLV need ffmpeg, a decoder that runs in your browser. It\'s a one-time 31 MB download, and we ask before fetching it.' },
      { q: 'Is there a file size limit?', a: 'Not from us: nothing is uploaded, so there\'s no upload cap or daily limit. Very long or 4K videos depend on your device\'s memory and speed, and a lower resolution helps if a conversion struggles.' },
      filePrivacyFaq,
    ],
    related: ['video-compressor', 'video-to-mp3', 'trim-video', 'resize-video'],
    flagship: { elsewhere: 'Upload size caps, daily limits or watermarks', here: 'Any size, no limits, no watermark, nothing uploaded' },
  },

  variant('mov', 'mp4', {
    title: 'MOV to MP4 Converter: iPhone videos to MP4, free, no upload',
    description: 'Convert MOV videos from an iPhone or Mac to MP4 for Windows, Android and the web. Often a quick copy with no quality loss. No upload, no watermark.',
    tagline: 'Turn iPhone and QuickTime MOV files into MP4s that play anywhere.',
    keywords: ['mov to mp4', 'convert mov to mp4', 'iphone video to mp4', 'quicktime to mp4', 'mov to mp4 converter', 'mov file won\'t play on windows', 'hevc to h264', 'mov to mp4 no watermark'],
    steps: [
      'Drop in your MOV video, for example one from your iPhone or a Mac screen recording.',
      'MP4 is already selected. For a video that plays on any PC, set the codec to H.264.',
      'Press Convert and download the MP4.',
    ],
    faq: [
      { q: 'Why are iPhone videos MOV files?', a: 'MOV is Apple\'s QuickTime format, and iPhones save their videos in it. It plays fine on Apple devices, but some Windows apps, Android phones, editors and upload forms want MP4.' },
      { q: 'Does converting lose quality?', a: 'Often not. MOV and MP4 hold the same kinds of video, so a landscape clip is usually just copied into an MP4, which takes seconds and changes nothing. Portrait phone videos, and any change of codec, quality or resolution, are re-encoded at high quality instead, which takes longer.' },
      { q: 'The MP4 still won\'t play on my Windows PC. Why?', a: 'Recent iPhones record in HEVC (H.265) by default. Some Windows PCs need an extra HEVC codec from the Microsoft Store to play it. Convert again with the codec set to H.264 and it will play everywhere, at the cost of a slower conversion.' },
      { q: 'Can my iPhone record in a more compatible format?', a: 'Yes. In Settings > Camera > Formats, choose "Most Compatible" and new videos use H.264 instead of HEVC. They are still MOV files, but they play almost anywhere once converted to MP4. The trade-off is bigger files.' },
    ],
    related: ['video-compressor', 'trim-video', 'mkv-to-mp4', 'video-to-mp3'],
  }),

  variant('webm', 'mp4', {
    title: 'WebM to MP4 Converter: for iPhone, editors & sharing, free',
    description: 'Convert WebM videos to MP4 so they play on iPhone, in video editors and on social apps. Converted on your device: no upload, no watermark.',
    tagline: 'Turn WebM screen recordings and downloads into MP4s that open anywhere.',
    keywords: ['webm to mp4', 'convert webm to mp4', 'webm to mp4 converter', 'webm to mp4 iphone', 'screen recording to mp4', 'webm converter', 'open webm file', 'vp9 to h264'],
    steps: [
      'Drop in your WebM video, such as a browser screen recording or a saved web video.',
      'MP4 is already selected, with H.264 video for the widest support.',
      'Press Convert and download the MP4.',
    ],
    faq: [
      { q: 'Why convert WebM to MP4?', a: 'WebM is an open web format that browsers and many screen recorders produce. Browsers play it, but plenty of video editors, phones, TVs and messaging apps expect MP4 with H.264, the most widely supported combination.' },
      { q: 'Why does it take longer than MOV to MP4?', a: 'WebM video is VP8, VP9 or AV1, while compatible MP4s use H.264. Changing codecs means re-encoding every frame, so it takes a while for long videos. Your device\'s video hardware is used where the browser allows it.' },
      { q: 'What happens to the sound?', a: 'WebM audio is usually Opus, which many MP4 players don\'t support, so it is re-encoded to AAC, the standard for MP4. You can also untick "Keep the sound" for a silent video.' },
      { q: 'Will the quality drop?', a: 'Re-encoding always changes the picture a little, but at the default "original" quality the difference is hard to see. Choose "balanced" or "small" if you\'d rather have a smaller file.' },
    ],
    related: ['video-compressor', 'mp4-to-webm', 'screen-recorder', 'video-to-gif'],
  }),

  variant('mp4', 'webm', {
    title: 'MP4 to WebM Converter: VP9 & AV1 video for the web, free',
    description: 'Convert MP4 to WebM with VP9 or AV1 video and Opus audio for websites and HTML5 players. In your browser: no upload, no size cap, no watermark.',
    tagline: 'Make web-ready WebM videos from your MP4s.',
    keywords: ['mp4 to webm', 'convert mp4 to webm', 'mp4 to webm converter', 'webm for website', 'html5 video converter', 'mp4 to vp9', 'mp4 to av1'],
    steps: [
      'Drop in your MP4 video.',
      'WebM is already selected. Leave the codec on auto for VP9, or pick AV1 for smaller files if your browser offers it.',
      'Press Convert and download the WebM.',
    ],
    faq: [
      { q: 'Why use WebM?', a: 'WebM is an open, royalty-free video format made for the web. All current major browsers play it, and it often makes smaller files than an H.264 MP4 of similar quality. Many sites offer both, with the MP4 as a fallback for older devices.' },
      { q: 'VP9 or AV1?', a: 'AV1 usually makes the smallest files, but it is slower to encode and older devices may struggle to play it smoothly. VP9 is the safe, widely supported choice. Only the codecs your browser can encode are shown.' },
      { q: 'Why does it take a while?', a: 'H.264 video isn\'t allowed in WebM, so every frame is re-encoded to VP9 or AV1. The sound is re-encoded to Opus. Long or high-resolution videos take longer, so a lower resolution speeds things up.' },
    ],
    related: ['webm-to-mp4', 'video-compressor', 'resize-video', 'video-to-gif'],
  }),

  variant('avi', 'mp4', {
    title: 'AVI to MP4 Converter: old camera & DivX videos, free',
    description: 'Convert old AVI videos from cameras, camcorders and DivX or Xvid files to MP4 that plays everywhere. It runs in your browser, so nothing is uploaded.',
    tagline: 'Give old AVI clips a new life as MP4s that play on any device.',
    keywords: ['avi to mp4', 'convert avi to mp4', 'avi to mp4 converter', 'divx to mp4', 'xvid to mp4', 'old camera video to mp4', 'avi converter', 'play avi on iphone'],
    steps: [
      'Drop in your AVI video, for example from an old digital camera or camcorder.',
      'The first time, allow the one-time 31 MB decoder download, since browsers can\'t read AVI on their own.',
      'Press Convert and download the MP4.',
    ],
    faq: [
      { q: 'Why does AVI need a decoder download?', a: 'Browsers can\'t read AVI files or the older codecs inside them, like DivX, Xvid or Motion JPEG. Rounder uses ffmpeg, compiled to run in your browser, which is a one-time 31 MB download served from our own site. We ask before fetching it, and your video still never leaves your device.' },
      { q: 'Why is AVI conversion slower than other formats?', a: 'The fallback decoder runs on a single CPU thread without the help of your graphics hardware. Short clips from old cameras convert quickly; long recordings take a while, so keep the tab open until it finishes.' },
      { q: 'Will the MP4 look worse than the AVI?', a: 'The video is re-encoded to H.264 at high quality, so it should look the same to the eye. It can\'t look better than the original, though, and old camera clips are often small and soft to begin with.' },
      { q: 'Does it work for WMV, FLV and MPEG files too?', a: 'Yes. The same decoder handles WMV, FLV, MPEG and other older formats. Drop them into the video converter and pick MP4.' },
    ],
    related: ['video-converter', 'video-compressor', 'mkv-to-mp4', 'merge-videos'],
  }),

  variant('mkv', 'mp4', {
    title: 'MKV to MP4 Converter: play on phones, TVs & editors, free',
    description: 'Convert MKV videos to MP4 for iPhone, Android, smart TVs and video editors. Often a fast copy with no quality loss. No upload, no size cap.',
    tagline: 'Rewrap MKV videos as MP4s that phones, TVs and editors accept.',
    keywords: ['mkv to mp4', 'convert mkv to mp4', 'mkv to mp4 converter', 'mkv to mp4 without losing quality', 'play mkv on iphone', 'mkv to mp4 for tv', 'remux mkv to mp4', 'mkv converter'],
    steps: [
      'Drop in your MKV video.',
      'MP4 is already selected. Leave the quality at "original" for a fast copy.',
      'Press Convert and download the MP4.',
    ],
    faq: [
      { q: 'Why won\'t my MKV play on my phone or TV?', a: 'MKV (Matroska) is a flexible container that many phones, smart TVs, editors and upload forms don\'t accept. MP4 is supported almost everywhere, even when the video inside is exactly the same.' },
      { q: 'Is the conversion lossless?', a: 'Often, yes. If the MKV holds H.264 or HEVC video, it is copied into the MP4 untouched, which takes seconds. Other codecs, like VP9 or older MPEG-4, are re-encoded to H.264, which takes longer. Sound MP4 players handle badly, such as Opus or surround tracks, is converted to stereo AAC.' },
      { q: 'What about subtitles and extra audio tracks?', a: 'Only the main video and audio track are kept. Subtitle tracks, extra languages and chapters are left out. To put subtitles back, burn them in with the add subtitles tool.' },
      { q: 'Some MKVs won\'t open. Why?', a: 'If your browser can\'t decode a codec inside the MKV, we offer the one-time 31 MB ffmpeg decoder download to handle it. Files that are damaged or use very unusual codecs may still fail.' },
    ],
    related: ['mov-to-mp4', 'video-compressor', 'add-subtitles-to-video', 'video-to-mp3'],
  }),
] satisfies Tool[];

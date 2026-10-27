import { filePrivacyFaq, type Tool } from '../types';

// The video compressor opened at a target size (VideoCompressor { targetMB }), one page per common upload limit.

type Copy = Pick<Tool, 'slug' | 'name' | 'title' | 'h1' | 'description' | 'tagline' | 'keywords' | 'steps' | 'faq'> & Partial<Pick<Tool, 'notes'>>;

const preset = (targetMB: number, copy: Copy): Tool => ({
  ...copy,
  category: 'video',
  island: 'VideoCompressor',
  props: { targetMB },
  variantOf: 'video-compressor',
  related: ['video-compressor', 'trim-video', 'resize-video', 'video-to-gif'],
});

const howMb = {
  q: 'Is it 1,000 or 1,024 KB per MB?',
  a: 'The target counts 1 MB as 1,000,000 bytes, the smaller of the two, so the file fits either way an app counts it.',
};

const steps = (mb: number) => [
  `Drop in your video. The target is already ${mb} MB, and the estimate under the settings shows the resolution and bitrate it will use.`,
  'Press Compress. Everything runs on your device with your browser\'s own video encoder, so a long clip takes a while; you can cancel at any time.',
  `Check the result line ("✓ fits under ${mb} MB", or why not), then download. If it came out over, "Try again, aiming lower" corrects for the miss.`,
];

export default [
  preset(8, {
    slug: 'compress-video-to-8mb',
    name: 'Compress video to 8 MB',
    title: 'Compress Video to 8 MB: shrink MP4 under 8 MB, no upload',
    h1: 'Compress video to *8 MB*',
    description: 'Shrink a video to under 8 MB for chat apps, forums and old upload limits. Picks the resolution and bitrate for you and checks the result. Nothing uploaded.',
    tagline: 'For older 8 MB limits on chat apps, forums and bots.',
    keywords: ['compress video to 8mb', 'video under 8mb', 'reduce video size to 8mb', '8mb video compressor', 'mp4 to 8mb'],
    steps: steps(8),
    faq: [
      {
        q: 'Who still uses an 8 MB limit?',
        a: 'Discord used 8 MB for free accounts for years, and many forums, bots, older apps and self-hosted chat servers kept that number. If you are sending to Discord itself today, see the 10 MB page.',
      },
      {
        q: 'How long can an 8 MB video be?',
        a: 'At a watchable 720p, roughly a minute; at 480p, two to three minutes. Past that the picture breaks up, and the tool warns you before you start. Trimming the clip is the most effective fix.',
      },
      howMb,
      filePrivacyFaq,
    ],
  }),
  preset(10, {
    slug: 'compress-video-to-10mb',
    name: 'Compress video to 10 MB',
    title: 'Compress Video to 10 MB for Discord: free, no upload',
    h1: 'Compress video to *10 MB*',
    description: 'Get a clip under 10 MB to send on Discord without Nitro. Picks resolution and bitrate from the length, checks the result, retries lower if it misses.',
    tagline: 'Under Discord\'s free 10 MB limit, at the best quality that fits.',
    keywords: ['compress video to 10mb', 'compress video for discord', 'video under 10mb', 'discord video compressor', 'reduce video size to 10mb', 'mp4 to 10mb'],
    steps: steps(10),
    faq: [
      {
        q: 'Why 10 MB for Discord?',
        a: 'Free Discord accounts can send files up to 10 MB at the time of writing; Nitro Basic and Nitro raise that. Discord has changed the number before (it was 8 MB, then 25 MB), so check the error message if an upload fails.',
      },
      {
        q: 'How much video fits in 10 MB?',
        a: 'About a minute at 720p or a 20–30 second gaming clip at 1080p, with stereo sound. The tool reads the clip\'s length and picks the largest resolution the bitrate can fill without turning blocky.',
      },
      {
        q: 'It came out at 10.3 MB. Why?',
        a: 'Video encoders aim for an average bitrate and land a little over or under, especially on short clips and fast motion. The result line flags it, and "Try again, aiming lower" re-runs aiming lower by how much it missed, plus a little spare.',
      },
      howMb,
      filePrivacyFaq,
    ],
  }),
  preset(25, {
    slug: 'compress-video-to-25mb',
    name: 'Compress video to 25 MB',
    title: 'Compress Video to 25 MB for Email: Gmail-size MP4, free',
    h1: 'Compress video to *25 MB*',
    description: 'Make a video small enough to attach to an email: under 25 MB for Gmail, smaller for stricter mail servers. Checks the result, no upload.',
    tagline: 'Small enough to attach to an email.',
    keywords: ['compress video to 25mb', 'compress video for email', 'video under 25mb', 'reduce video size for gmail', 'email video compressor', 'mp4 to 25mb'],
    steps: steps(25),
    notes: {
      limits: [{ where: 'Gmail', limit: 'Attachments up to 25 MB per email; bigger files are sent as a Google Drive link instead.', source: 'https://support.google.com/mail/answer/6584' }],
    },
    faq: [
      {
        q: 'Will a 24.9 MB video always send?',
        a: 'Not always. Email sends attachments encoded as text, which makes them about a third bigger, and some mail servers count that encoded size. If a message bounces, compress to about 18 MB instead; just type 18 in the custom box.',
      },
      {
        q: 'Which format do email recipients open most easily?',
        a: 'MP4 with H.264, the default here. It plays on Windows, Macs, iPhones and Android phones without extra apps.',
      },
      howMb,
      filePrivacyFaq,
    ],
  }),
  preset(50, {
    slug: 'compress-video-to-50mb',
    name: 'Compress video to 50 MB',
    title: 'Compress Video to 50 MB: reduce MP4 size under 50 MB',
    h1: 'Compress video to *50 MB*',
    description: 'Shrink a long or 4K video to under 50 MB with the sharpest picture that fits. Resolution and bitrate are chosen for you and the result is checked. No upload.',
    tagline: 'Room for a few minutes of HD, under 50 MB.',
    keywords: ['compress video to 50mb', 'video under 50mb', 'reduce video size to 50mb', 'mp4 to 50mb', '50mb video compressor'],
    steps: steps(50),
    faq: [
      {
        q: 'Where do 50 MB limits come up?',
        a: 'Discord Nitro Basic at the time of writing, many forum and support-ticket upload boxes, and some course and job portals. The custom box takes any other number.',
      },
      {
        q: 'How much fits in 50 MB?',
        a: 'Around five minutes at 720p or two to three minutes at 1080p with sound. Phones record at a high bitrate, so a 1-minute 4K clip of a few hundred MB usually comes down to 50 MB at 1080p with little visible change.',
      },
      howMb,
      filePrivacyFaq,
    ],
  }),
] satisfies Tool[];

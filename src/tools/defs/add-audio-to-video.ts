import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'add-audio-to-video',
  category: 'video',
  name: 'Add music to video',
  title: 'Add Music to Video: put audio on MP4 online free, no watermark',
  h1: 'Add *music* to video',
  description: 'Put a song or voiceover on your video. Trim it, pick where it starts, loop it, fade it out and balance it with the original sound. Nothing is uploaded.',
  tagline: 'Drop a video and a song, line them up, and mix them to taste.',
  keywords: ['add music to video', 'add audio to video', 'put music on video', 'add song to video', 'replace audio in video', 'add background music', 'merge audio and video', 'add mp3 to video'],
  island: 'AddAudioToVideo',
  steps: [
    'Drop in your video and the music or voiceover you want on it.',
    'Trim the music, choose when it starts, set both volumes, and loop or fade it if you like. Press play to hear the mix.',
    'Click "Add music to video" and download the result.',
  ],
  faq: [
    { q: 'Can I keep the original sound and add music under it?', a: 'Yes. Both volumes are adjustable from 0 to 200%, so you can keep speech on top of quiet background music, or set the original to zero to replace it entirely.' },
    { q: 'What if the song is shorter or longer than my video?', a: 'A longer song is cut at the end of the video, with an optional fade-out. A shorter one can loop until the video ends, or just stop.' },
    { q: 'Does it re-encode my video?', a: 'Usually not. The picture is copied without re-encoding, so there is no quality loss and it is fast. Phone videos stored sideways with a rotation flag are re-encoded once at high quality so they play upright, and older formats such as AVI are converted to MP4. The new soundtrack is always encoded (AAC for MP4 and MOV, Opus for WebM and MKV).' },
    { q: 'Which audio formats can I add?', a: 'MP3, WAV, M4A, AAC, OGG, Opus and FLAC work right away. Rarer formats such as WMA or AC-3 need a one-time 31 MB decoder download first.' },
    filePrivacyFaq,
  ],
  related: ['mute-video', 'audio-cutter', 'trim-video', 'video-to-mp3'],
  flagship: { elsewhere: 'Watermark or upload cap on free plans', here: 'No watermark, any length' },
} satisfies Tool;

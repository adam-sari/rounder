import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'mute-video',
  category: 'video',
  name: 'Remove audio from video',
  title: 'Remove Audio from Video: mute MP4, MOV & WebM online free',
  h1: 'Remove *audio* from video',
  description: 'Mute videos in one click. Strips the sound from MP4, MOV, WebM and MKV, in bulk, usually without re-encoding the picture. Nothing is uploaded.',
  tagline: 'Strip the sound from one video or a whole batch at once.',
  keywords: ['mute video', 'remove audio from video', 'remove sound from video', 'silent video', 'strip audio from video', 'mute mp4', 'video without sound', 'delete audio track'],
  island: 'MuteVideo',
  steps: [
    'Drop in one or more videos (MP4, MOV, WebM, MKV and more).',
    'Click "Remove audio". The picture is usually copied as is, so it is quick.',
    'Preview the silent result, then download each file or all of them as a zip.',
  ],
  faq: [
    { q: 'Does removing the audio lower the video quality?', a: 'Usually not. For most MP4, MOV, WebM and MKV files the video stream is copied bit for bit and only the sound track is dropped, so the picture is identical. Two cases are re-encoded once at high quality: phone videos stored sideways with a rotation flag (they come out upright), and older formats like AVI or WMV, which are converted to MP4.' },
    { q: 'Can I mute several videos at once?', a: 'Yes. Drop in as many as you like and they are processed one after another. Download them one by one or together as a zip.' },
    { q: 'Can I mute only part of a video?', a: 'This tool removes the whole sound track. To replace the sound with music instead, use Add music to video and set the original audio volume to zero.' },
    { q: 'Which formats work?', a: 'MP4, MOV, WebM and MKV usually work right away and keep their format. AVI, WMV, FLV and other older formats need a one-time 31 MB decoder download and come out as MP4.' },
    filePrivacyFaq,
  ],
  related: ['add-audio-to-video', 'video-to-mp3', 'video-compressor', 'trim-video'],
  next: ['add-audio-to-video'],
} satisfies Tool;

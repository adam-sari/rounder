import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'audio-speed-changer',
  category: 'audio',
  name: 'Change audio speed / tempo',
  title: 'Audio Speed Changer: speed up or slow down audio, free',
  h1: 'Audio *speed* changer',
  description: 'Speed up or slow down a song, podcast or voice note from 0.5× to 2× without the chipmunk effect, or let the pitch follow like a record. Free, no upload.',
  tagline: 'Practice a song slower or get through a lecture faster, with the pitch left where it was.',
  keywords: ['audio speed changer', 'change speed of audio', 'slow down song', 'speed up audio', 'tempo changer', 'slow down music without changing pitch', 'speed up mp3', 'change bpm of song', 'nightcore maker'],
  island: 'AudioSpeed',
  steps: [
    'Drop in a song, podcast, voice note or video: MP3, M4A, WAV, OGG, FLAC and more.',
    'Pick a speed from 0.5× to 2×, choose whether the pitch stays put or follows like a record, and press Preview to hear 10 seconds.',
    'Pick an output format and press Change speed, then download the new file.',
  ],
  faq: [
    { q: 'Will the pitch change?', a: 'Not unless you want it to. With "keep pitch", the audio is time-stretched so voices and notes stay exactly where they were. With "like a record", the pitch rises when you speed up and drops when you slow down, the way a turntable sounds; sped up, that is the classic nightcore sound.' },
    { q: 'How far can I slow down or speed up?', a: 'From half speed to double speed. Within that range speech stays clear and music holds together. The further you go from 1×, the more you may hear some smearing on drums and a slightly hollow tone, so try the preview first.' },
    { q: 'Can I match a specific BPM?', a: 'Enter the song\'s BPM and the tool shows the new tempo as you change the speed. For example, 1.1× turns 120 BPM into 132 BPM. You can type an exact speed like 1.07 in the box next to the slider.' },
    { q: 'Does it work for podcasts and lectures?', a: 'Yes. Pick "voice" under sound: it uses shorter analysis frames, which keep consonants crisp. A one-hour talk at 1.5× becomes 40 minutes.' },
    filePrivacyFaq,
  ],
  related: ['pitch-changer', 'video-speed-changer', 'audio-cutter', 'bpm-finder'],
} satisfies Tool;

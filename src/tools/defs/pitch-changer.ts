import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'pitch-changer',
  category: 'audio',
  name: 'Change pitch / key of a song',
  title: 'Pitch Changer: change the key of a song online, free',
  h1: 'Pitch *changer*',
  description: 'Shift a song up or down by up to 12 semitones without changing its speed. Fine-tune in cents and preview before you save. Free, and nothing is uploaded.',
  tagline: 'Move a song into a key that suits your voice or instrument, at the same tempo.',
  keywords: ['pitch changer', 'change pitch of song', 'key changer', 'transpose song', 'pitch shifter online', 'change key of song', 'semitone shifter', 'lower pitch of audio', 'raise pitch of mp3'],
  island: 'PitchChanger',
  steps: [
    'Drop in a song, voice recording or video: MP3, M4A, WAV, OGG, FLAC and more.',
    'Move the slider by semitones, fine-tune in cents if you need to, and press Preview to hear 10 seconds of the result.',
    'Pick an output format and press Change pitch, then download the new file.',
  ],
  faq: [
    { q: 'Does changing the pitch change the speed?', a: 'No. The song keeps its exact length and tempo; only the notes move. If you want both to change together, like a record played faster, use the audio speed changer.' },
    { q: 'How many semitones should I shift?', a: 'One semitone is one piano key. Two semitones takes a song in C to D, and twelve is a full octave. To sing a song lower, try −2 to −4. Pick the song\'s key from the list and the tool shows which key you end up in.' },
    { q: 'Will it still sound natural?', a: 'Shifts of a few semitones sound close to the original. Larger shifts are more noticeable, especially on voices, which start to sound chipmunk-like going up or hollow going down because their tone moves with the notes. Use the 10-second preview to check before you export, and pick "voice" for speech.' },
    { q: 'What are cents for?', a: 'A cent is a hundredth of a semitone. Fine-tune lets you match a recording that is slightly off standard tuning. For example, music tuned to A = 432 Hz is about −32 cents from the usual 440 Hz, so +32 cents brings it back.' },
    filePrivacyFaq,
  ],
  related: ['audio-speed-changer', 'audio-cutter', 'online-tuner', 'bpm-finder'],
} satisfies Tool;

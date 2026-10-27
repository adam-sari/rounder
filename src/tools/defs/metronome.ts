import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'metronome',
  category: 'audio',
  name: 'Metronome',
  title: 'Online Metronome: free, with tap tempo & tempo trainer',
  h1: 'Online *metronome*',
  description: 'Free online metronome, 20–300 BPM. Time signatures, accents, subdivisions, tap tempo and a tempo trainer, with rock-steady timing. No app needed.',
  tagline: 'Steady clicks from 20 to 300 BPM, with accents, subdivisions and a trainer that speeds you up.',
  keywords: ['online metronome', 'metronome', 'free metronome', 'tap tempo', 'bpm metronome', 'metronome with accents', 'tempo trainer', '6/8 metronome', 'drum metronome'],
  island: 'Metronome',
  steps: [
    'Set the tempo with the slider, the + and − buttons, the arrow keys, or by tapping along.',
    'Pick a time signature and subdivision. Click any beat bar to make it a strong accent, a light accent, normal or silent.',
    'Press Start (or the space bar). Switch on the tempo trainer to add a few BPM every few bars as you practice.',
  ],
  faq: [
    { q: 'How accurate is the timing?', a: 'Each click is booked ahead of time on your device\'s audio clock rather than with an ordinary page timer, which is the same approach music apps use. That keeps it steady while the page is busy, and it keeps going in a background tab.' },
    { q: 'How does 6/8 work here?', a: 'The BPM counts the note in the bottom number, so 6/8 at 180 plays six eighth notes per bar at 180 a minute. Beats 1 and 4 are accented so you feel the two groups of three. 7/8 is grouped 2+2+3; you can change any accent by clicking its beat.' },
    { q: 'What does the tempo trainer do?', a: 'It raises the tempo by the amount you choose every few bars, counting from when you press Start, and stops climbing at your target. It\'s a simple way to build speed on a tricky passage. Stopping and starting again goes back to your starting tempo.' },
    { q: 'Why do the clicks seem late with Bluetooth headphones?', a: 'Wireless headphones add a delay of their own. The flashing circle follows the latency the browser reports so it matches what you hear, but for playing along, wired headphones or speakers are tighter.' },
    privacyFaq,
  ],
  related: ['online-tuner', 'bpm-finder', 'voice-recorder'],
} satisfies Tool;

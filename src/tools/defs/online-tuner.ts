import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'online-tuner',
  category: 'audio',
  name: 'Online guitar tuner',
  title: 'Online Guitar Tuner: free mic tuner for guitar, bass & ukulele',
  h1: 'Online guitar *tuner*',
  description: 'Tune your guitar with your microphone. Standard, drop D and DADGAD, plus bass, ukulele, violin and chromatic modes, reference tones and adjustable A4.',
  tagline: 'Play a string, watch the needle, stop when it turns green. Bass, ukulele and violin too.',
  keywords: ['guitar tuner', 'online tuner', 'tuner with microphone', 'bass tuner', 'ukulele tuner', 'violin tuner', 'chromatic tuner', 'drop d tuning', 'dadgad tuning', 'a 432 hz tuning'],
  island: 'Tuner',
  steps: [
    'Pick your instrument and tuning, then press Start tuner and allow the microphone.',
    'Pluck one string and let it ring. The needle shows how many cents flat or sharp it is, and which string it thinks you are on.',
    'Turn the peg until the needle sits in the green zone. Each string gets a tick once it has been in tune for a moment. Click a string to hear its note.',
  ],
  faq: [
    { q: 'Why does it need my microphone?', a: 'To hear your instrument. The sound is analyzed in your browser about 20 times a second to find the pitch, and nothing is recorded, saved or sent anywhere. Browsers only ask after you press Start, and only offer the microphone on secure (https) pages.' },
    { q: 'It says microphone access was blocked. What now?', a: 'Your browser remembered a "block" for this site. Click the icon at the left of the address bar, set the microphone to Allow and press Start again. On a phone, also check that the browser app itself is allowed to use the microphone in your system settings.' },
    { q: 'How accurate is it?', a: 'On clean test tones the pitch detection (the McLeod pitch method) reads within a fraction of a cent. With a real instrument, a quiet room and a single ringing string matter most. The needle turns green within ±3 cents, which is closer than most ears can tell apart.' },
    { q: 'What does the A4 setting do?', a: 'It sets the pitch everything else is tuned from. 440 Hz is the modern standard; some orchestras use 442 or 443, and some players prefer 432. Change it to match a band, a recording or a piano that sits a little off.' },
    privacyFaq,
  ],
  related: ['metronome', 'pitch-changer', 'voice-recorder'],
} satisfies Tool;

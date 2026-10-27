import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'voice-recorder',
  category: 'audio',
  name: 'Online voice recorder',
  title: 'Online Voice Recorder: record audio, save as MP3, free',
  h1: 'Online voice *recorder*',
  description: 'Record your voice with your microphone, trim it, and save it as MP3, WAV or M4A. Free, no sign-up, no time limit, and nothing is uploaded.',
  tagline: 'Record from your mic, trim the ends, and save it as MP3, WAV or M4A.',
  keywords: ['voice recorder', 'online voice recorder', 'record audio online', 'mic recorder', 'record voice to mp3', 'audio recorder', 'voice memo', 'record microphone', 'sound recorder'],
  island: 'VoiceRecorder',
  steps: [
    'Press Record and allow your browser to use the microphone. Pick another mic or turn voice processing off if you need to.',
    'Talk. Watch the level meter, pause and resume whenever you like, and press stop when you are done.',
    'Play the recording back, drag the handles to trim the start and end, then save it as MP3, WAV, M4A or the original file.',
  ],
  faq: [
    {
      q: 'Is there a time limit?',
      a: "No. You can record for as long as you like. A minute of recording takes about 1 MB, so the only limit is your device's free space.",
    },
    {
      q: 'What happens if I close or reload the page while recording?',
      a: 'The recording is saved to your browser every second as you go, so it comes back the next time you open this page, minus at most the last second. Your recordings stay in this browser until you delete them, and they are never uploaded.',
    },
    {
      q: 'Should I turn noise suppression and echo cancellation on or off?',
      a: 'Leave them on for speech, especially with a laptop mic or without headphones. Turn them off for music, singing or instruments, because they are tuned for voices and can make other sounds come and go.',
    },
    {
      q: 'Why does it ask for microphone permission, and what if I blocked it?',
      a: 'Browsers never let a website hear your microphone without asking, and we only ask when you press Record or Test mic. If you blocked it, click the icon at the left of the address bar, allow the microphone for this site and try again.',
    },
    filePrivacyFaq,
  ],
  related: ['audio-to-text', 'audio-cutter', 'audio-noise-reduction', 'audio-converter'],
  next: ['audio-noise-reduction', 'audio-to-text'],
  flagship: { elsewhere: 'Time limits or uploads to a server', here: 'Unlimited length, never leaves your device' },
} satisfies Tool;

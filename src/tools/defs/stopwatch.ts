import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'stopwatch',
  category: 'everyday',
  name: 'Stopwatch',
  title: 'Online Stopwatch with Laps: free, to 1/100 of a second',
  h1: 'Online *stopwatch*',
  description: 'Free online stopwatch with lap and split times to a hundredth of a second, fastest and slowest lap highlights and CSV export. No sign-up.',
  tagline: 'Time anything to the hundredth of a second, with laps you can export.',
  keywords: ['online stopwatch', 'stopwatch with laps', 'lap timer', 'split timer', 'free stopwatch', 'stopwatch online', 'running lap timer', 'stopwatch milliseconds'],
  island: 'Stopwatch',
  steps: [
    'Press Start or the space bar to begin timing.',
    'Press Lap (or L) at each split. Your fastest lap turns green and your slowest red.',
    'Stop to pause, then copy your laps or download them as a CSV for a spreadsheet.',
  ],
  faq: [
    { q: 'How accurate is it?', a: "Times are read from your device's clock and shown to a hundredth of a second, so the stopwatch doesn't drift even in a background tab. In practice your own reaction time when pressing a key or button matters more." },
    { q: "What's the difference between lap time and total?", a: 'Lap time is how long that one lap took. Total, often called the split, is the time from the start up to the end of that lap.' },
    { q: 'What happens if I close or reload the page?', a: 'The stopwatch and your laps are saved in this browser, so after a reload it carries on where it was, and a running stopwatch has kept counting. Press Reset to clear it.' },
    { q: 'Are there keyboard shortcuts?', a: 'Space starts and stops, L (or Enter) records a lap and R resets once the stopwatch is stopped.' },
    privacyFaq,
  ],
  related: ['online-timer', 'pomodoro-timer'],
} satisfies Tool;

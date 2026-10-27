import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'online-timer',
  category: 'everyday',
  name: 'Online timer / countdown',
  title: 'Online Timer: free countdown timer with alarm & fullscreen',
  h1: 'Online *timer*',
  description: 'Free online countdown timer with a chime, quick presets, several named timers at once and fullscreen. Keeps exact time in background tabs.',
  tagline: 'Set a countdown, get a chime when it ends. Run as many as you need at once.',
  keywords: ['countdown timer', 'online timer', 'timer with alarm', '5 minute timer', '10 minute timer', 'kitchen timer', 'fullscreen timer', 'set a timer'],
  island: 'OnlineTimer',
  steps: [
    'Type the hours, minutes and seconds, or tap a quick preset like 5 or 25 minutes.',
    'Press Start (or the space bar). Give it a name and add more timers if you are juggling several things.',
    'When time is up you hear a chime, the tab title says so and, if you like, a desktop notification pops up.',
  ],
  faq: [
    { q: 'Does the timer keep going if I switch tabs?', a: 'Yes. It works from the start time rather than counting ticks, so it stays exact even when the browser slows a background tab down, and the chime plays on time. If your phone locks or the browser is closed, the page may be paused; the timer will show the right time again when you come back.' },
    { q: "Why didn't I hear the alarm?", a: 'Browsers only allow sound after you have interacted with the page, which pressing Start takes care of. Check the volume slider and your device volume, and use the Test button to hear the chime.' },
    { q: 'Can I run more than one timer?', a: 'Yes. Add as many timers as you like, give each one a name, and they all run side by side. The one that finishes first takes over the big display.' },
    { q: 'Are there keyboard shortcuts?', a: 'Space starts and pauses the selected timer, R resets it and F switches fullscreen on and off.' },
    privacyFaq,
  ],
  related: ['stopwatch', 'pomodoro-timer', 'date-calculator'],
} satisfies Tool;

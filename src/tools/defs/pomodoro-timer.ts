import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'pomodoro-timer',
  category: 'everyday',
  name: 'Pomodoro timer',
  title: 'Pomodoro Timer: free focus timer with breaks & daily count',
  h1: 'Pomodoro *timer*',
  description: "Free Pomodoro timer with focus sessions, short and long breaks, auto-start, a gentle chime and a count of today's sessions. No sign-up.",
  tagline: 'Work in focused stretches with breaks in between, and see how much you got done today.',
  keywords: ['pomodoro timer', 'pomodoro technique', 'focus timer', 'study timer', '25 minute timer', 'tomato timer', 'work break timer', 'pomodoro online'],
  island: 'PomodoroTimer',
  steps: [
    'Optionally write down what you are working on, and adjust the focus and break lengths if 25 and 5 minutes don\'t suit you.',
    'Press Start and focus until the gentle chime. Your break starts by itself, or when you are ready.',
    'After every few focus sessions you get a longer break. The dots and the daily count show your progress.',
  ],
  faq: [
    { q: 'What is the Pomodoro Technique?', a: 'A way of working in short, focused stretches, classically 25 minutes, each followed by a 5 minute break, with a longer break after every four. It was created by Francesco Cirillo and named after the tomato-shaped kitchen timer he used.' },
    { q: 'Can I change the lengths?', a: 'Yes. Set any length for focus, short breaks and long breaks, choose how many focus sessions come before a long break, and decide whether breaks and focus sessions start on their own.' },
    { q: 'Where is my daily count kept?', a: "In this browser's local storage, along with your settings. It starts from zero each new day, and clearing your browser data resets it." },
    { q: 'Does it keep time in a background tab?', a: 'Yes. It works from the start time rather than counting ticks, so the chime plays on time even when the browser slows down a background tab. Space starts and pauses, R resets and S skips to the next phase.' },
    privacyFaq,
  ],
  related: ['online-timer', 'stopwatch'],
} satisfies Tool;

import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'wheel-spinner',
  category: 'everyday',
  name: 'Wheel spinner / random name picker',
  title: 'Wheel Spinner: random name picker wheel, fair & free',
  h1: 'Wheel *spinner*',
  description: 'Spin a wheel to pick a random name or winner. Paste a list, add weights, remove winners as you go and save your lists. Fair, free, no sign-up.',
  tagline: 'Paste names, spin, and let a fair wheel decide.',
  keywords: ['spin the wheel', 'random name picker', 'wheel of names', 'name wheel', 'prize wheel', 'decision wheel', 'random picker wheel', 'raffle picker', 'classroom name picker'],
  island: 'WheelSpinner',
  steps: [
    'Type or paste your names or options, one per line. Add *2 after one to give it twice the chance.',
    'Press spin and watch the wheel slow down on the winner.',
    'Remove the winner to draw the next one, or save the list to use again later.',
  ],
  faq: [
    { q: 'Is the wheel really fair?', a: 'Yes. The winner is chosen first with your browser\'s secure random generator (crypto.getRandomValues), using rejection sampling so no entry is even slightly favored. The wheel then animates to land on that winner, so how hard or when you click makes no difference.' },
    { q: 'How do weights work?', a: 'Add a star and a number after an entry, like "Pizza *3", to give it three times the chance of an entry without one. Its slice gets three times as wide, so what you see matches the real odds. "*0" keeps a line in your list but leaves it off the wheel.' },
    { q: 'How many entries can I add?', a: 'As many as you like. With hundreds of entries the slices get too thin for labels, but every entry still has its fair chance and the winner is shown in full.' },
    { q: 'Where are my saved lists kept?', a: 'In your browser\'s local storage on this device. They aren\'t sent anywhere, so they won\'t follow you to another browser, and clearing your site data removes them.' },
    privacyFaq,
  ],
  related: ['random-number-generator', 'dice-roller', 'remove-duplicate-lines'],
} satisfies Tool;

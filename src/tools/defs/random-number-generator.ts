import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'random-number-generator',
  category: 'everyday',
  name: 'Random number generator',
  title: 'Random Number Generator: pick numbers in any range, free',
  h1: 'Random number *generator*',
  description: 'Generate random numbers in any range: one or thousands, with or without repeats, whole or decimal, sorted or not. Also picks random items from a list.',
  tagline: 'Fair random numbers in any range, or a random pick from your list.',
  keywords: ['random number generator', 'random number between 1 and 100', 'number picker', 'rng', 'random number list', 'random numbers no repeats', 'random decimal generator', 'random picker from list'],
  island: 'RandomNumber',
  steps: [
    'Set the lowest and highest number, and how many you want.',
    'Choose whether repeats are allowed, decimals, and sort order.',
    'Generate, then copy the results. Switch to "from a list" to pick items instead.',
  ],
  faq: [
    { q: 'How random are the numbers?', a: 'They come from your browser\'s secure random generator, crypto.getRandomValues, the same one used for encryption keys. To fit them to your range we use rejection sampling instead of a simple remainder, so every number in the range is exactly equally likely.' },
    { q: 'Are the minimum and maximum included?', a: 'Yes. A range of 1 to 10 can give both 1 and 10.' },
    { q: 'What does "no repeats" do?', a: 'Each number can come up only once, like drawing numbered balls from a bag without putting them back. It\'s handy for raffles and seating orders. You can\'t ask for more numbers than the range holds.' },
    { q: 'How do decimals work?', a: 'Pick how many decimal places you want, from 1 to 6. Every value with that many places between your minimum and maximum is equally likely.' },
    privacyFaq,
  ],
  related: ['wheel-spinner', 'dice-roller', 'password-generator', 'uuid-generator'],
} satisfies Tool;

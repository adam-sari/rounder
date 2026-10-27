import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'dice-roller',
  category: 'everyday',
  name: 'Dice roller',
  title: 'Dice Roller: roll d4, d6, d8, d10, d12, d20 & d100 online',
  h1: 'Dice *roller*',
  description: 'Roll virtual dice online: d4 to d100, many at once, or type notation like 2d6+3 or 4d6kh3. Totals, roll history and a coin flip. Free.',
  tagline: 'Any dice, any notation, rolled fairly with a satisfying clatter of pixels.',
  keywords: ['roll dice', 'dice roller', 'd20 roller', 'virtual dice', 'roll a d6', 'dnd dice roller', 'dice notation', 'flip a coin', '4d6 drop lowest'],
  island: 'DiceRoller',
  steps: [
    'Tap the dice you want, or type notation such as 2d6+3 or 4d6kh3.',
    'Press roll, or hit Enter.',
    'Read the total and each die, and look back through your roll history.',
  ],
  faq: [
    { q: 'What dice notation can I use?', a: '"2d6" rolls two six-sided dice and "d20+5" adds 5 to a d20. Combine terms with + and -, like "d20 + d4 - 1". "kh" keeps the highest dice and "kl" the lowest, so "4d6kh3" rolls four and keeps the best three, and "2d20kh1" is advantage. "dl" and "dh" drop the lowest or highest, and "d%" is a d100.' },
    { q: 'Are the rolls random?', a: 'Yes. Every die uses your browser\'s secure random generator (crypto.getRandomValues) with rejection sampling, so each face is exactly equally likely. The animation is decided after the roll and is just for show.' },
    { q: 'How many dice can I roll at once?', a: 'Up to 1,000 dice in a single roll, with any number of sides from 2 to 1,000. Big rolls are shown as compact numbers instead of animated dice.' },
    { q: 'Can I flip a coin too?', a: 'Yes. Switch to coin mode to flip one coin or up to 100 at once, with a count of heads and tails.' },
    privacyFaq,
  ],
  related: ['random-number-generator', 'wheel-spinner'],
} satisfies Tool;

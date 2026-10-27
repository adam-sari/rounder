import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'percentage-calculator',
  category: 'everyday',
  name: 'Percentage calculator',
  title: 'Percentage Calculator: % of, % change, increase & reverse',
  h1: 'Percentage *calculator*',
  description: 'Work out X% of a number, what percent one number is of another, percentage change, increases and discounts, and the price before tax.',
  tagline: 'Every everyday percentage question, written as a sentence you fill in.',
  keywords: ['percentage calculator', 'what percent of', 'percent change calculator', 'percentage increase', 'percentage decrease', 'reverse percentage', 'calculate discount', 'price before tax', 'percentage points'],
  island: 'PercentageCalculator',
  steps: [
    'Find the sentence that matches your question.',
    'Type your numbers into the blanks. Commas and % signs are fine.',
    'Read the answer as you type, with the working shown underneath.',
  ],
  faq: [
    { q: 'How do I work out a percentage change?', a: 'Subtract the old value from the new one, divide by the old value, and multiply by 100. Going from 80 to 100 is a change of 20, and 20 ÷ 80 × 100 = a 25% increase.' },
    { q: 'Why doesn\'t taking 20% off undo adding 20%?', a: 'Each percentage is taken of a different number. Adding 20% to 100 gives 120, but 20% of 120 is 24, so taking it off leaves 96. To find the price before a 20% tax, divide by 1.2 instead, which the reverse percentage calculator does for you.' },
    { q: 'What is the difference between percent and percentage points?', a: 'Percentage points are the simple gap between two percentages, so a rate going from 4% to 5% rose by 1 point. Percent change compares that gap to the starting rate, which makes the same move a 25% increase.' },
    { q: 'Can I use negative numbers or decimals?', a: 'Yes. Any number works, including decimals and negatives. Percentage change is measured against the size of the starting value, so -50 to -25 counts as a 50% increase.' },
    privacyFaq,
  ],
  related: ['loan-calculator', 'unit-converter', 'date-calculator', 'currency-converter'],
} satisfies Tool;

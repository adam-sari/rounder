import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'age-calculator',
  category: 'everyday',
  name: 'Age calculator',
  title: 'Age Calculator: exact age in years, months & days',
  h1: 'Age *calculator*',
  description: 'Find your exact age in years, months and days, plus total weeks, days and hours, a countdown to your next birthday, and your star sign. Free.',
  tagline: 'Your exact age to the day, or to the second if you know your birth time.',
  keywords: ['how old am i', 'age calculator', 'calculate age from date of birth', 'exact age', 'age in days', 'birthday countdown', 'chinese zodiac by birth date', 'what day was i born'],
  island: 'AgeCalculator',
  steps: [
    'Enter a date of birth, and a birth time if you want it to the second.',
    'Leave "today" selected, or pick another date to see the age on that day.',
    'Read the exact age, the totals, and how long until the next birthday.',
  ],
  faq: [
    { q: 'How is the exact age worked out?', a: 'We count whole years first, then whole months, then the days left over, all from the date of birth. Someone born on January 31 turns one month old on the last day of February, the same way people count months in everyday life.' },
    { q: 'What about birthdays on February 29?', a: 'In years without a February 29 you can choose whether the birthday counts on February 28 or March 1. Customs and laws differ by country, and some treat March 1 as the official date for things like coming of age.' },
    { q: 'Why does the birth time matter?', a: 'Without a time, the age changes at midnight. With one, the age only ticks over at the moment you were born, and the totals count up live to the second.' },
    { q: 'How is the Chinese zodiac sign worked out?', a: 'The Chinese zodiac year starts at Lunar New Year, which falls between January 21 and February 21, not on January 1. If you were born in January or early February, your sign may belong to the year before. The star sign uses the usual date ranges, which can shift by a day from year to year.' },
    privacyFaq,
  ],
  related: ['date-calculator', 'percentage-calculator', 'bmi-calculator'],
} satisfies Tool;

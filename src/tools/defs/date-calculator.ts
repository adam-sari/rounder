import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'date-calculator',
  category: 'everyday',
  name: 'Date calculator',
  title: 'Date Calculator: days between dates & add or subtract days',
  h1: 'Date *calculator*',
  description: 'Count the days, weeks, months or business days between two dates, or add and subtract days, months and workdays. Skips your holidays too.',
  tagline: 'Days between dates, business days, and what the date will be in 90 days.',
  keywords: ['days between dates', 'date calculator', 'business days calculator', 'add days to date', 'how many days until', 'working days between dates', 'subtract days from date', 'date difference'],
  island: 'DateCalculator',
  steps: [
    'Choose whether to count the days between two dates, or add or subtract time from a date.',
    'Pick your dates and amounts, and decide whether the end date counts.',
    'Open "Weekends & holidays" to change days off or paste a list of holidays to skip.',
  ],
  faq: [
    { q: 'Does it count the start and end dates?', a: 'By default the start date counts and the end date doesn\'t, so Monday to Tuesday is 1 day. Tick "include the end date" to count both, which adds one day and is what you want for things like how many days a trip or a booking lasts.' },
    { q: 'How are business days counted?', a: 'Business days are every day except your days off (Saturday and Sunday unless you change them) and any holidays you list. Holidays that fall on a day off are only skipped once. Adding 1 business day to a Friday gives the next Monday.' },
    { q: 'What happens when I add a month to January 31?', a: 'February has no 31st, so the result is the last day of February. That\'s the usual rule for adding months, and the calculator tells you when it has applied it.' },
    { q: 'Do time zones or daylight saving affect the result?', a: 'No. Dates are counted as calendar days, never as hours, so the day the clocks change still counts as exactly one day.' },
    privacyFaq,
  ],
  related: ['age-calculator', 'online-timer', 'percentage-calculator'],
} satisfies Tool;

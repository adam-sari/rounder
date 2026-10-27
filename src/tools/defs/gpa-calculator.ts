import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'gpa-calculator',
  category: 'everyday',
  name: 'GPA calculator',
  title: 'GPA Calculator: weighted & unweighted, semester and cumulative',
  h1: 'GPA *calculator*',
  description: 'Calculate weighted and unweighted GPA by semester and overall, with letter grades, credits and honors or AP courses. Your courses stay saved on your device.',
  tagline: 'Weighted and unweighted GPA, per semester and cumulative.',
  keywords: ['gpa calculator', 'weighted gpa calculator', 'cumulative gpa calculator', 'college gpa calculator', 'high school gpa calculator', 'semester gpa calculator', 'unweighted gpa', 'how to calculate gpa'],
  island: 'GpaCalculator',
  steps: [
    'Add your courses with their credits, letter grade and type (regular, honors or AP/IB).',
    'Add more semesters, and your GPA so far if you have one, to get a cumulative GPA.',
    'Read your weighted and unweighted GPA. Everything stays saved in your browser for next time.',
  ],
  faq: [
    { q: 'What is the difference between weighted and unweighted GPA?', a: 'Unweighted GPA uses the plain 4.0 scale for every course. Weighted GPA gives harder courses a bonus: here 0.5 for honors and 1.0 for AP or IB, so an A in an AP class counts as 5.0. The bonus is not added to an F. Schools set their own rules, so check how yours weights courses.' },
    { q: 'How is GPA calculated?', a: 'Each grade is turned into points (A = 4.0, B+ = 3.3 and so on), multiplied by the course\'s credits, added up and divided by the total credits. Courses with more credits count for more. Courses without a grade yet are left out.' },
    { q: 'Does an A+ count as 4.0 or 4.3?', a: 'It depends on your school. Many cap the scale at 4.0, while some give an A+ 4.3. Pick the one your school uses in the side panel.' },
    { q: 'Will my courses still be here next time?', a: 'Yes, on this device and browser. They are saved in your browser\'s local storage, not on our servers, so clearing your browsing data or using a private window starts you fresh.' },
    privacyFaq,
  ],
  related: ['percentage-calculator', 'pomodoro-timer', 'word-counter'],
} satisfies Tool;

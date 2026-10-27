import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'bmi-calculator',
  category: 'everyday',
  name: 'BMI calculator',
  title: 'BMI Calculator: metric & imperial, with WHO categories',
  h1: 'BMI *calculator*',
  description: 'Calculate your body mass index in cm and kg or feet and pounds. See your WHO category, the healthy weight range for your height, and what BMI misses.',
  tagline: 'Your BMI, its WHO category and a healthy weight range for your height.',
  keywords: ['bmi calculator', 'body mass index', 'bmi calculator kg', 'bmi calculator lbs', 'healthy weight for my height', 'bmi chart', 'ideal weight calculator', 'am i overweight'],
  island: 'BmiCalculator',
  steps: [
    'Choose cm and kg or feet and pounds.',
    'Enter your height and weight. Your BMI and category appear right away.',
    'Check the healthy weight range for your height, and read what BMI can and can\'t tell you.',
  ],
  faq: [
    { q: 'How is BMI calculated?', a: 'BMI is your weight in kilograms divided by your height in meters squared. In imperial units it is 703 × weight in pounds ÷ height in inches squared. Both give the same number.' },
    { q: 'What is a healthy BMI?', a: 'For adults, the World Health Organization classes 18.5 to 24.9 as a healthy weight, 25 to 29.9 as overweight and 30 or more as obesity, split into three classes. Some guidelines use lower thresholds for people of certain ethnic backgrounds, because health risks start at a lower BMI for them.' },
    { q: 'Is BMI accurate?', a: 'It is a quick screening number, not a measure of body fat or health. It can\'t tell muscle from fat, so very muscular people can read as overweight, and it can miss extra fat in older adults. It is not meant for pregnancy. Treat it as a starting point for a conversation with a doctor, not a diagnosis.' },
    { q: 'Can I use it for a child or teenager?', a: 'Not with the adult categories. Under 20, BMI is compared with others of the same age and sex on growth charts and given as a percentile. This calculator shows the number but doesn\'t work out percentiles; a doctor, or the CDC\'s BMI calculator for children and teens, can.' },
    privacyFaq,
  ],
  related: ['unit-converter', 'age-calculator', 'percentage-calculator'],
} satisfies Tool;

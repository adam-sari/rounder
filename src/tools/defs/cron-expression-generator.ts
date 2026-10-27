import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'cron-expression-generator',
  category: 'dev',
  name: 'Cron expression generator',
  title: 'Cron Expression Generator: build, explain & test cron jobs',
  h1: 'Cron expression *generator*',
  description: 'Build a cron expression visually or paste one to see it in plain English, check it for errors and preview the next 10 run times in your time zone and UTC.',
  tagline: 'Build a schedule visually, read it in plain English, see when it runs next.',
  keywords: ['cron generator', 'crontab generator', 'cron expression builder', 'cron schedule', 'crontab guru', 'cron parser', 'cron validator', 'cron every 5 minutes', 'next cron run'],
  island: 'CronBuilder',
  steps: [
    'Pick a preset, paste an expression, or build one field at a time with the picker.',
    'Read the plain-English summary to check it means what you think.',
    'Look over the next 10 run times in your time zone or UTC, then copy the expression.',
  ],
  faq: [
    { q: 'What do the five fields mean?', a: 'In order: minute (0–59), hour (0–23), day of the month (1–31), month (1–12 or JAN–DEC) and day of the week (0–6 or SUN–SAT, where 0 and 7 are both Sunday). A * means "every", 1-5 is a range, 1,15 is a list and */10 means every 10th value.' },
    { q: 'Can I use seconds?', a: 'Yes. Add a sixth field at the front for seconds, as used by Spring, node-cron and Quartz, or tick "include seconds". Classic crontab on Linux only has the five fields and runs at most once a minute.' },
    { q: 'What happens when I set both day of month and day of week?', a: 'Standard cron runs the job when either one matches, not only when both do. So "0 0 13 * 5" runs on the 13th of every month and on every Friday. The tool points this out when it applies.' },
    { q: 'Which time zone does cron use?', a: 'The clock of the machine running it, which is often UTC on servers. Switch the run list between your own time zone and UTC to see both. Times that fall in the hour skipped when clocks spring forward don\'t exist on a local clock, so they aren\'t listed; classic cron usually runs those jobs right after the jump, while some schedulers skip them.' },
    privacyFaq,
  ],
  related: ['regex-tester', 'json-formatter', 'uuid-generator'],
} satisfies Tool;

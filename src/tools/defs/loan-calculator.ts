import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'loan-calculator',
  category: 'everyday',
  name: 'Loan & mortgage calculator',
  title: 'Loan & Mortgage Calculator with Amortization Schedule',
  h1: 'Loan & mortgage *calculator*',
  description: 'Work out loan and mortgage payments, total interest and payoff date. Add extra payments, property tax, insurance and PMI, and export the schedule as CSV.',
  tagline: 'Payment, total interest and payoff date, with a full amortization schedule.',
  keywords: ['mortgage calculator', 'amortization schedule', 'loan payment calculator', 'car loan calculator', 'extra payment calculator', 'mortgage calculator with taxes and insurance', 'biweekly mortgage calculator', 'personal loan calculator'],
  island: 'LoanCalculator',
  steps: [
    'Enter the amount, interest rate and term. Switch to mortgage to add a down payment, property tax, insurance and PMI.',
    'Add extra payments, if you plan to make them, to see how much interest and time they save.',
    'Explore the chart and the schedule by year or by payment, then export it as a CSV file.',
  ],
  faq: [
    { q: 'How is the payment worked out?', a: 'With the standard formula for a fixed-rate loan: every payment is the same, and each one first covers the interest on the remaining balance, with the rest paying down the loan. Early payments are mostly interest, later ones mostly principal. Interest is rounded to the cent each payment, the way lenders do it, so the last payment may differ by a few cents.' },
    { q: 'Should I enter the interest rate or the APR?', a: 'The interest rate. APR also folds in fees and other costs, so it would make the payment come out slightly too high. This calculator assumes a fixed rate; for an adjustable-rate loan it shows what you would pay if today\'s rate never changed.' },
    { q: 'How does biweekly work here?', a: 'Biweekly means 26 payments a year, sized to clear the loan over the term you entered. Some lenders offer "accelerated" biweekly plans instead, taking half your monthly payment every two weeks, which adds up to one extra monthly payment a year. To model that, stay on monthly and add one twelfth of your monthly payment as an extra with every payment.' },
    { q: 'When does PMI stop?', a: 'PMI usually applies to conventional loans with less than 20% down. Here it is charged until your balance falls to 78% of the home price. In the US, lenders must cancel it automatically when the original schedule reaches that point, and you can ask to drop it earlier, once you reach 80%. Extra payments get you there sooner, but you may need to ask your lender to cancel it.' },
    privacyFaq,
  ],
  related: ['percentage-calculator', 'currency-converter', 'date-calculator'],
} satisfies Tool;

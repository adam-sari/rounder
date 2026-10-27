import type { Tool } from '../types';

export default {
  slug: 'currency-converter',
  category: 'everyday',
  name: 'Currency converter',
  title: 'Currency Converter: daily ECB exchange rates & 30-day chart',
  h1: 'Currency *converter*',
  description: 'Convert between 30 major currencies with daily European Central Bank reference rates. Compare several at once and see a 30-day chart. Free, no sign-up.',
  tagline: 'Daily reference rates for 30 currencies, a list of your favorites and a 30-day trend.',
  keywords: ['currency converter', 'exchange rate', 'usd to eur', 'eur to usd', 'gbp to usd', 'convert currency', 'exchange rate today', 'money converter', 'ecb exchange rates'],
  island: 'CurrencyConverter',
  steps: [
    'Type an amount and pick the currencies to convert from and to. Search by code or name.',
    'Read the result and the rate both ways, or hit swap to flip the pair.',
    'Add the currencies you check often to your list, and look at the 30-day chart for the trend.',
  ],
  faq: [
    { q: 'Where do the exchange rates come from?', a: 'From the European Central Bank\'s euro foreign exchange reference rates, fetched through the free Frankfurter API. The ECB publishes them once each working day at around 16:00 CET. Pairs that don\'t involve the euro, like USD to JPY, are worked out through the euro. The date of the rates is shown under the converter.' },
    { q: 'Is this the rate my bank or card will give me?', a: 'Probably not. These are mid-market reference rates, published for information. Banks, card networks and exchange counters add their own margin and fees, so the amount you actually get or pay will usually be a little worse. Use this to sanity-check a price, not as a quote.' },
    { q: 'Why don\'t the rates change during the day?', a: 'Reference rates are a daily snapshot, not a live market feed. They update once each working day and stay the same over weekends and ECB holidays. If you need tick-by-tick prices for trading, use a broker or market data service.' },
    { q: 'Why is my currency missing?', a: 'The ECB publishes reference rates for about 30 major currencies. Others, including many in Africa, Latin America and the Middle East, aren\'t covered, and we\'d rather leave them out than show numbers from an unclear source.' },
    { q: 'Does it work offline?', a: 'Yes, once you\'ve opened it online. The latest rates are saved in your browser and refreshed after 12 hours. When you\'re offline, the saved rates are used instead, with a note showing their date. The 30-day chart needs a connection.' },
    { q: 'Is my data sent anywhere?', a: 'No. Amounts and currency choices stay in your browser. The only network requests fetch public exchange rates from the Frankfurter API, and they contain nothing you typed beyond the currency pair for the chart.' },
  ],
  related: ['unit-converter', 'percentage-calculator', 'loan-calculator', 'invoice-generator'],
} satisfies Tool;

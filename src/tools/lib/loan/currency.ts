export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'INR', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK',
  'BRL', 'MXN', 'ZAR', 'SGD', 'HKD', 'AED', 'PHP', 'NGN', 'KRW', 'CNY', 'TRY', 'ILS',
] as const;

const EURO = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ');

const BY_REGION: Record<string, string> = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IN: 'INR', JP: 'JPY', CH: 'CHF', SE: 'SEK', NO: 'NOK',
  DK: 'DKK', PL: 'PLN', CZ: 'CZK', BR: 'BRL', MX: 'MXN', ZA: 'ZAR', SG: 'SGD', HK: 'HKD', AE: 'AED', PH: 'PHP',
  NG: 'NGN', KR: 'KRW', CN: 'CNY', TR: 'TRY', IL: 'ILS',
};

/** Best guess at the local currency from a locale like "en-GB" or "de"; US dollars otherwise */
export function guessCurrency(locale: string) {
  try {
    const region = new Intl.Locale(locale).maximize().region ?? '';
    return EURO.includes(region) ? 'EUR' : (BY_REGION[region] ?? 'USD');
  } catch {
    return 'USD';
  }
}

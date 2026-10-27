export type Frequency = 'monthly' | 'biweekly' | 'weekly';

export const PER_YEAR: Record<Frequency, number> = { monthly: 12, biweekly: 26, weekly: 52 };

const cents = (x: number) => Math.round(x * 100) / 100;

/** Level payment that pays off `principal` in `periods` payments at `rate` interest per period */
export function levelPayment(principal: number, rate: number, periods: number) {
  if (periods <= 0 || principal <= 0) return 0;
  if (rate === 0) return principal / periods;
  return (principal * rate) / (1 - (1 + rate) ** -periods);
}

/** Number of payments in a term, e.g. 30 years biweekly → 780 */
export function periodCount(termMonths: number, frequency: Frequency) {
  return Math.round((termMonths / 12) * PER_YEAR[frequency]);
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Date of payment `i` (0 = first). Monthly payments keep the day of month, clamped to short months. */
export function paymentDate(start: string, i: number, frequency: Frequency) {
  const [y, m, d] = start.split('-').map(Number);
  if (frequency !== 'monthly') return iso(Date.UTC(y, m - 1, d) + i * (frequency === 'weekly' ? 7 : 14) * DAY);
  const month = m - 1 + i;
  const last = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, month, Math.min(d, last)));
}

export interface Pmi {
  /** cost per year */
  yearly: number;
  /** charged until the balance falls to this amount */
  until: number;
}

/**
 * PMI on a conventional loan with under 20% down. It ends automatically once the
 * balance reaches 78% of the original home value.
 */
export function pmiPlan(price: number, loan: number, ratePct: number): Pmi | undefined {
  if (!(ratePct > 0) || loan <= 0 || loan <= price * 0.8) return undefined;
  return { yearly: (loan * ratePct) / 100, until: price * 0.78 };
}

export interface LoanInput {
  principal: number;
  /** yearly interest rate in percent, e.g. 6.5 */
  rate: number;
  termMonths: number;
  frequency: Frequency;
  /** first payment date, YYYY-MM-DD */
  start: string;
  /** added to every payment */
  extra?: number;
  /** added once a year, on the last payment of each loan year */
  extraYearly?: number;
  pmi?: Pmi;
}

export interface Row {
  n: number;
  date: string;
  /** scheduled principal + interest */
  payment: number;
  principal: number;
  interest: number;
  extra: number;
  pmi: number;
  balance: number;
}

export interface Schedule {
  /** scheduled principal + interest per payment */
  payment: number;
  rows: Row[];
  totalInterest: number;
  totalExtra: number;
  totalPmi: number;
}

/**
 * Amortization schedule rounded to the cent like a lender's statement: interest is
 * rounded each period and the last payment absorbs the leftover cents.
 */
export function amortize(input: LoanInput): Schedule {
  const { principal, frequency, start, pmi } = input;
  const perYear = PER_YEAR[frequency];
  const periods = periodCount(input.termMonths, frequency);
  const rate = input.rate / 100 / perYear;
  const payment = cents(levelPayment(principal, rate, periods));
  const extra = Math.max(0, input.extra ?? 0);
  const extraYearly = Math.max(0, input.extraYearly ?? 0);

  const rows: Row[] = [];
  let balance = cents(principal);
  let totalInterest = 0;
  let totalExtra = 0;
  let totalPmi = 0;

  for (let n = 1; balance > 0 && n <= periods; n++) {
    const interest = cents(balance * rate);
    let part = Math.min(payment - interest, balance);
    // rounding leaves a few cents on the final scheduled payment
    if (n === periods) part = balance;
    const left = cents(balance - part);
    const prepay = cents(Math.min(left, extra + (n % perYear === 0 ? extraYearly : 0)));
    const insurance = pmi && balance > pmi.until ? cents(pmi.yearly / perYear) : 0;
    rows.push({
      n,
      date: paymentDate(start, n - 1, frequency),
      payment: cents(part + interest),
      principal: cents(part),
      interest,
      extra: prepay,
      pmi: insurance,
      balance: cents(left - prepay),
    });
    balance = cents(left - prepay);
    totalInterest += interest;
    totalExtra += prepay;
    totalPmi += insurance;
  }

  return { payment, rows, totalInterest: cents(totalInterest), totalExtra: cents(totalExtra), totalPmi: cents(totalPmi) };
}

export interface YearRow {
  year: number;
  /** scheduled principal plus any extra */
  principal: number;
  interest: number;
  extra: number;
  pmi: number;
  /** balance after the year's last payment */
  balance: number;
}

/** Totals per calendar year (what a lender's yearly interest statement shows) */
export function byYear(rows: Row[]): YearRow[] {
  const out: YearRow[] = [];
  for (const r of rows) {
    const year = Number(r.date.slice(0, 4));
    let y = out.at(-1);
    if (y?.year !== year) out.push((y = { year, principal: 0, interest: 0, extra: 0, pmi: 0, balance: 0 }));
    y.principal = cents(y.principal + r.principal + r.extra);
    y.interest = cents(y.interest + r.interest);
    y.extra = cents(y.extra + r.extra);
    y.pmi = cents(y.pmi + r.pmi);
    y.balance = r.balance;
  }
  return out;
}

/** Recurring housing costs added to each payment, from yearly (tax, insurance) and monthly (HOA) amounts */
export interface Escrow {
  tax: number;
  insurance: number;
  hoa: number;
}

export function escrowPerPayment(taxYearly: number, insuranceYearly: number, hoaMonthly: number, frequency: Frequency): Escrow {
  const perYear = PER_YEAR[frequency];
  return {
    tax: cents(Math.max(0, taxYearly) / perYear),
    insurance: cents(Math.max(0, insuranceYearly) / perYear),
    hoa: cents((Math.max(0, hoaMonthly) * 12) / perYear),
  };
}

/** Payment schedule as CSV (plain numbers so spreadsheets can sum them) */
export function scheduleCsv(rows: Row[], escrow?: Escrow) {
  const money = (x: number) => x.toFixed(2);
  const head = ['Payment', 'Date', 'Principal & interest', 'Principal', 'Interest', 'Extra principal'];
  if (escrow) head.push('PMI', 'Property tax', 'Home insurance', 'HOA', 'Total paid');
  head.push('Balance');
  const lines = rows.map((r) => {
    const cells = [String(r.n), r.date, money(r.payment), money(r.principal), money(r.interest), money(r.extra)];
    if (escrow) {
      const total = r.payment + r.extra + r.pmi + escrow.tax + escrow.insurance + escrow.hoa;
      cells.push(money(r.pmi), money(escrow.tax), money(escrow.insurance), money(escrow.hoa), money(total));
    }
    cells.push(money(r.balance));
    return cells.join(',');
  });
  return [head.join(','), ...lines].join('\r\n');
}

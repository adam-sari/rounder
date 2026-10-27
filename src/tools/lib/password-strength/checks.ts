export interface Check {
  label: string;
  pass: boolean;
}

/** Plain composition checks shown beside the zxcvbn score. They inform, they don't decide. */
export function passwordChecks(password: string): Check[] {
  const length = [...password].length;
  return [
    { label: 'At least 12 characters', pass: length >= 12 },
    { label: 'Lowercase letters', pass: /\p{Ll}/u.test(password) },
    { label: 'Uppercase letters', pass: /\p{Lu}/u.test(password) },
    { label: 'Numbers', pass: /\p{N}/u.test(password) },
    { label: 'Symbols or spaces', pass: /[^\p{L}\p{N}]/u.test(password) },
    { label: 'No character repeated 3+ times in a row', pass: !/(.)\1\1/u.test(password) },
  ];
}

/** Turns zxcvbn's log10 guess count into words ("about 10 billion guesses") */
export function guessesInWords(log10: number) {
  if (log10 < 3) return `about ${Math.max(1, Math.round(10 ** log10)).toLocaleString('en-US')} guesses`;
  const names: [number, string][] = [[33, 'decillion'], [30, 'nonillion'], [27, 'octillion'], [24, 'septillion'], [21, 'sextillion'], [18, 'quintillion'], [15, 'quadrillion'], [12, 'trillion'], [9, 'billion'], [6, 'million'], [3, 'thousand']];
  if (log10 >= 36) return `about 10^${Math.floor(log10)} guesses`;
  // pick the unit by the rounded figure, so 10^8.9999 reads "1 billion", not "1,000 million"
  const [exp, name] = names.find(([e]) => Math.round(10 ** (log10 - e)) >= 1)!;
  return `about ${Math.round(10 ** (log10 - exp)).toLocaleString('en-US')} ${name} guesses`;
}

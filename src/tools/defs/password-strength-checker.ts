import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'password-strength-checker',
  category: 'files',
  name: 'Password strength checker',
  title: 'Password Strength Checker: crack time & breach check',
  h1: 'Password strength *checker*',
  description: 'See how long your password would take to crack, get tips to improve it, and optionally check known breaches without ever sending the password.',
  tagline: 'Realistic strength scores and crack times, checked on your device.',
  keywords: ['password strength checker', 'how secure is my password', 'password strength test', 'password crack time', 'is my password strong', 'have i been pwned password', 'password checker', 'zxcvbn'],
  island: 'PasswordStrength',
  steps: [
    'Type or paste a password. It is checked as you type, entirely on this page.',
    'Read the score, the crack time for each kind of attack and the tips.',
    'Optionally check whether it has shown up in a known data breach.',
  ],
  faq: [
    {
      q: 'How is the strength measured?',
      a: 'With zxcvbn, the open-source estimator Dropbox created. Instead of just counting symbols, it looks for what attackers actually try first: common passwords, dictionary words, names, dates, keyboard patterns like "qwerty", repeats and l33t swaps. It then estimates how many guesses a cracker would need.',
    },
    {
      q: 'What do the four crack times mean?',
      a: 'They are the same guess count at different speeds. A login page that limits attempts allows about 100 guesses an hour. An unprotected one, about 10 a second. If a site\'s password database leaks, attackers guess offline: around 10,000 a second against slow hashes such as bcrypt, and about 10 billion a second against fast ones like MD5. These are rough planning figures, not guarantees.',
    },
    {
      q: 'Is the breach check safe?',
      a: 'Yes. It is off until you click it. Your password is hashed with SHA-1 on your device and only the first 5 characters of that hash go to Have I Been Pwned. The service returns hundreds of matching hash endings, and the comparison happens in your browser, so neither the password nor its full hash is ever sent.',
    },
    {
      q: 'What makes a good password?',
      a: 'Length and randomness. Four or more random words, or 16+ random characters from a password generator, beat clever substitutions like P@ssw0rd. Use a different password for every site and keep them in a password manager.',
    },
    privacyFaq,
  ],
  related: ['password-generator', 'file-encryptor', 'hash-generator'],
} satisfies Tool;

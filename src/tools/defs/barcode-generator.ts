import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'barcode-generator',
  category: 'everyday',
  name: 'Barcode generator',
  title: 'Barcode Generator: EAN-13, UPC, Code 128 & more, PNG or SVG',
  h1: 'Barcode *generator*',
  description: 'Make EAN-13, UPC-A, Code 128, Code 39, ITF-14 and other barcodes with check digits done for you. Download PNG or SVG, or a whole list as a ZIP.',
  tagline: 'Print-ready barcodes with the check digits worked out for you, one at a time or a whole list at once.',
  keywords: ['barcode maker', 'ean 13 barcode generator', 'upc barcode generator', 'code 128 barcode generator', 'bulk barcode generator', 'barcode svg', 'free barcode generator', 'check digit calculator'],
  island: 'BarcodeGenerator',
  steps: [
    'Pick a format such as Code 128, EAN-13 or UPC-A, and type your value.',
    'Adjust the bar width, height, text and colors. Missing check digits are added for you, and wrong ones are pointed out.',
    'Download a PNG or SVG, or switch to batch to turn a whole list into a ZIP.',
  ],
  faq: [
    { q: 'Which barcode format should I use?', a: 'For products sold in stores, use the EAN-13 or UPC-A number assigned to your company by GS1; a made-up number won\'t be recognized at checkout. For your own labels, inventory and shipping, Code 128 is the usual pick because it\'s compact and holds letters as well as digits. ITF-14 is for outer cartons.' },
    { q: 'What is a check digit?', a: 'The last digit of EAN, UPC and ITF-14 codes is calculated from the others, so scanners can catch a misread. Type the number without it and it\'s added for you. Type the full number and it\'s checked, with a one-click fix if it\'s wrong.' },
    { q: 'PNG or SVG?', a: 'SVG is a vector file that stays perfectly sharp at any size, which makes it the best choice for print and design apps. PNG opens everywhere; pick 2× or 4× for crisp printing.' },
    { q: 'Can I make many barcodes at once?', a: 'Yes. Switch to batch, paste one value per line, and download them all as a ZIP of PNG or SVG files named after their values. There\'s no cap on how many.' },
    privacyFaq,
  ],
  related: ['qr-code-generator', 'qr-code-scanner', 'invoice-generator'],
} satisfies Tool;

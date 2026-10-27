import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'invoice-generator',
  category: 'creator',
  name: 'Invoice generator',
  title: 'Free Invoice Generator: PDF invoices, no sign-up or watermark',
  h1: 'Invoice *generator*',
  description: 'Make professional PDF invoices with your logo, taxes, discounts and any currency. No account, no watermark. Invoices are saved on your device.',
  tagline: 'Fill in the form, watch the invoice take shape, download a crisp PDF.',
  keywords: ['invoice generator', 'free invoice maker', 'invoice template', 'create invoice pdf', 'freelance invoice', 'invoice maker no sign up', 'vat invoice', 'bill template'],
  island: 'InvoiceGenerator',
  steps: [
    'Add your business details and logo once; they carry over to every new invoice.',
    'Fill in the client, dates and line items. Taxes, discounts and totals are worked out for you.',
    'Pick a template and accent color, then download the PDF. The invoice number moves up by one for the next.',
  ],
  faq: [
    { q: 'Is it really free, with no watermark?', a: 'Yes. There is no account, no watermark and no limit on how many invoices you make or download. The PDF has only what you put on it.' },
    { q: 'Where are my invoices saved?', a: 'In your browser\'s storage on this device, so they\'re there next time you open the page. Clearing site data removes them, so use "Back up all invoices" under JSON to keep a copy, or to move them to another computer.' },
    { q: 'How is tax calculated?', a: 'Use one rate for the whole invoice or a rate per item. A discount is taken off before tax. You can round tax on each line or once on the total; the two can differ by a cent, so pick whichever your accountant or tax office expects.' },
    { q: 'Is the PDF a real, searchable document?', a: 'Yes. Text is real text, not a picture, so it stays sharp when printed and can be searched and copied. Latin, Greek and Cyrillic characters are supported, and any currency your browser knows can be used.' },
    filePrivacyFaq,
  ],
  related: ['email-signature-generator', 'merge-pdf', 'sign-pdf', 'currency-converter'],
  flagship: { elsewhere: 'Account required or branding on the PDF', here: 'No account, no branding, unlimited invoices' },
} satisfies Tool;

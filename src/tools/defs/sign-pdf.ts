import { LIMITS } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'sign-pdf',
  category: 'pdf',
  name: 'Sign PDF',
  title: 'Sign PDF Online Free: draw, type or upload a signature',
  h1: 'Sign *PDF*',
  description: 'Sign a PDF in your browser. Draw, type or upload your signature, add initials, your name and the date. No account, no watermark, nothing uploaded.',
  tagline: 'Add your signature, initials and the date to any PDF, right on your device.',
  keywords: ['sign pdf', 'sign pdf online free', 'electronic signature', 'e-sign pdf', 'add signature to pdf', 'sign document online', 'fill and sign pdf', 'docusign alternative'],
  island: 'SignPdf',
  steps: [
    'Drop in your PDF. Password-protected files work too, once you enter the password.',
    'Create your signature by drawing, typing or uploading a photo of it, then click where it goes. Add initials, your name, the date or check marks the same way.',
    'Drag anything to fine-tune it, then download the signed PDF.',
  ],
  faq: [
    {
      q: 'Is this a legally binding signature?',
      a: "It's a simple electronic signature: a picture of your signature placed on the page, much like signing a printout and scanning it. Laws such as the US ESIGN Act and the EU's eIDAS regulation accept electronic signatures for many everyday agreements, but some documents need more, such as a certificate-based signature, a witness or a notary. If you're not sure, ask whoever asked you to sign.",
    },
    {
      q: 'Is it the same as a digital signature?',
      a: "No. A digital signature uses a certificate to prove who signed and that the file hasn't changed since. This tool adds a visible signature only, without a certificate.",
    },
    {
      q: 'Is my signature saved anywhere?',
      a: 'Only if you tick "Remember on this device". It\'s then kept in this browser\'s storage so you can reuse it next time, and the × next to it removes it. It is never uploaded, and without that tick it\'s gone when you close the page.',
    },
    {
      q: 'Can I sign a password-protected PDF?',
      a: "Yes. Enter the password to open it, and the signed copy is saved with the same password. Files that only restrict printing or editing open without one, and the signed copy won't carry those restrictions.",
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Draw', effect: 'Ink follows your pen: a stylus that reports pressure sets the line width, otherwise quick strokes run thinner, like a fountain pen.' },
      { name: 'Type', effect: 'Your name in one of four handwriting fonts (Caveat, Dancing Script, Homemade Apple, Sacramento), loaded from this site, not a font service.' },
      { name: 'Upload', effect: 'A photo of your signature on paper. "Remove the white background" makes everything lighter than the cut-off (210 by default) transparent, with a soft edge so the ink stays clean.' },
      { name: 'Remember on this device', effect: 'Keeps up to four signatures and four sets of initials in this browser\'s storage. Off by default.' },
    ],
    formats: [
      { name: 'What lands in the PDF', about: 'The signature is embedded as an image; names, dates and check marks are real PDF text and shapes. The original pages are left untouched underneath.' },
      { name: 'Electronic vs digital signature', about: 'This is a visible electronic signature. It carries no certificate, so a PDF reader won\'t show it in a signature panel.' },
    ],
    limits: [LIMITS.gmail, LIMITS.outlook],
  },
  related: ['edit-pdf', 'fill-pdf-form', 'merge-pdf', 'protect-pdf'],
  next: ['protect-pdf', 'compress-pdf'],
  flagship: { elsewhere: 'An account first, and only a few free signatures', here: 'Sign as many PDFs as you like, no account' },
} satisfies Tool;

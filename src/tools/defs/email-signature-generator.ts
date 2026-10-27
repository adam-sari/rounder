import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'email-signature-generator',
  category: 'creator',
  name: 'Email signature generator',
  title: 'Free Email Signature Generator for Gmail, Outlook & Apple Mail',
  h1: 'Email signature *generator*',
  description: 'Make a professional HTML email signature with your photo, links and brand color. Copy it into Gmail, Outlook or Apple Mail. Free, no sign-up.',
  tagline: 'Pick a template, fill in your details, paste it into your email app.',
  keywords: ['email signature generator', 'gmail signature', 'outlook signature', 'html email signature', 'free email signature', 'signature template', 'apple mail signature', 'professional email signature'],
  island: 'EmailSignature',
  steps: [
    'Fill in your name, job, contact details and social links. Add a photo or logo by its web address.',
    'Choose one of five templates, a color and a font that every email app has.',
    'Click "Copy signature" and paste it into your signature settings. The steps for Gmail, Outlook and Apple Mail are right below the preview.',
  ],
  faq: [
    { q: 'Why does my photo need to be a web address?', a: 'Email signatures don\'t carry files. Each time someone opens your email, their app loads the picture from the web, so it has to live at a public https address, for example on your website. You can embed the file directly instead, but Gmail removes embedded images and Outlook often blocks them or shows them as attachments.' },
    { q: 'Will it look the same in every email app?', a: 'The signature is built from simple tables with inline styles and web-safe fonts, which is how email newsletters get consistent results in Gmail, Outlook and Apple Mail. Rounded photo corners are one detail that classic Outlook for Windows ignores; it shows the photo square.' },
    { q: 'Is there any branding or tracking in the signature?', a: 'No. The HTML holds only what you typed: no "made with" link, no hidden tracking pixel and no redirect links.' },
    { q: 'Why are the social icons letters rather than logos?', a: 'Logo icons would have to be images loaded from someone\'s server every time your email is opened. Small colored badges built from text work in every email app, load instantly and are never blocked.' },
    privacyFaq,
  ],
  related: ['invoice-generator', 'qr-code-generator', 'crop-image'],
  flagship: { elsewhere: 'Branding added to free signatures', here: 'No branding, no sign-up' },
} satisfies Tool;

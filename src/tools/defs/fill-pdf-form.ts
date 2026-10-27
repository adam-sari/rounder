import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'fill-pdf-form',
  category: 'pdf',
  name: 'Fill PDF form',
  title: 'Fill PDF Form Online: type into PDF forms free, no upload',
  h1: 'Fill PDF *forms*',
  description: 'Fill in PDF forms in your browser: text boxes, checkboxes, dropdowns and radio buttons. Save a filled or flattened copy. No upload, no sign-up.',
  tagline: "Type straight into the form's own fields, then download the filled PDF.",
  keywords: ['fill pdf form', 'pdf form filler', 'fill out pdf online', 'fillable pdf', 'type on pdf form', 'fill in pdf', 'flatten pdf form', 'complete pdf form'],
  island: 'FillPdfForm',
  steps: [
    'Drop in a fillable PDF form. If it is password-protected, you will be asked for its password.',
    'Type into the fields right on the page, or use the list of fields, which is handier on a phone.',
    'Download the filled PDF. Turn on Flatten if the answers should no longer be editable.',
  ],
  faq: [
    {
      q: 'What if my PDF has no fields to fill?',
      a: "Some forms are only printed lines and boxes, with no fields built in. The tool tells you when that's the case, and you can still type anywhere on those pages with Edit PDF.",
    },
    {
      q: 'Will my answers show up in other PDF apps?',
      a: "Yes. Answers are saved into the form's own fields and their appearance is redrawn, so they show in Adobe Reader, Preview, browsers and other viewers, and stay editable unless you flatten. Accented letters, Greek and Cyrillic work; Chinese, Japanese, Korean and Arabic text can't be drawn yet.",
    },
    {
      q: 'What does Flatten do?',
      a: 'It draws your answers onto the page and removes the fields, so they can no longer be changed. That suits a finished form you are sending off. Keep an unflattened copy if you might need to edit it later.',
    },
    {
      q: 'Can it fill XFA forms or run form calculations?',
      a: "No. XFA forms, made with Adobe LiveCycle, need Adobe Acrobat Reader or another app with XFA support; the tool tells you when you open one. Scripts that add up or check fields don't run here either, so fill in calculated boxes yourself.",
    },
    filePrivacyFaq,
  ],
  related: ['sign-pdf', 'edit-pdf', 'merge-pdf', 'protect-pdf'],
  flagship: { elsewhere: 'A few free forms a day, then a subscription', here: 'Fill as many forms as you like' },
} satisfies Tool;

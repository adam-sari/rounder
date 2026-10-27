import { filePrivacyFaq, type Tool } from '../types';

// Upload-ready photos, signatures and PDFs for online applications, the way Indian exam, job and government portals ask
// for them (KB ranges, pixel sizes). Every notice sets its own numbers, so these pages start from common examples and
// keep every number editable. Nothing here claims to match a particular exam's rules.

const specsVary = {
  q: 'Are these the official sizes for my exam?',
  a: 'Not necessarily. Each recruitment or admission notice sets its own sizes, and they change between years. The numbers here are common examples to start from. Always type the exact numbers printed in your own notice. Rounder isn\'t connected to any exam body or government portal.',
};

const whiteBackground = {
  q: 'Can it change the background to white?',
  a: 'This page only sizes the picture. Use the Background remover or the Passport photo maker first if the notice asks for a plain white background, then bring the result here to size it.',
};

export default [
  {
    slug: 'exam-photo-signature-resizer',
    category: 'image',
    name: 'Exam photo & signature resizer',
    title: 'Photo & Signature Resizer for Online Exam Forms (KB & px)',
    h1: 'Exam photo & *signature* resizer',
    description: 'Resize your photo and signature to the KB range and pixel size an online application asks for, like 20–50 KB at 200 × 230 px. Type your notice\'s numbers.',
    tagline: 'Photo, signature and thumb impression, sized to your notice.',
    keywords: ['photo and signature resizer', 'exam photo resize', 'photo resize 20kb to 50kb', 'signature resize 10kb to 20kb', 'photo ka size kam kare', 'online form photo size', 'ssc photo resize', 'ibps photo signature size', 'govt job photo resize'],
    island: 'ImageResizer',
    props: { mode: 'target', rangeKb: [20, 50], unit: 'px', w: 200, h: 230, forms: true },
    variantOf: 'image-resizer',
    steps: [
      'Pick Photo, Signature or Thumb impression, then change the KB range and the width × height to the numbers in your notice (pixels, or cm at the DPI it gives).',
      'Drop in your photo or scanned signature. It is cropped to that shape and saved as a JPG inside the KB range.',
      'Check that the result line says "✓ within …", then download and upload it to the form.',
    ],
    faq: [
      specsVary,
      {
        q: 'What sizes do forms usually ask for?',
        a: 'Many application portals ask for a photo of 20–50 KB and a signature of 10–20 KB, often with pixel sizes such as 200 × 230 for the photo and 140 × 60 for the signature. Some give the size in cm instead, for example 3.5 × 4.5 cm; switch the unit to cm and the tool works out the pixels at the DPI you set.',
      },
      {
        q: 'My signature comes out under 10 KB. What now?',
        a: 'A small signature on white paper has very little detail, so even the highest JPG quality can stay under 10 KB. The tool then adds blank padding (a comment block inside the JPG that viewers ignore) to reach the minimum, and says so in the result line. The signature itself looks exactly the same.',
      },
      whiteBackground,
      filePrivacyFaq,
    ],
    related: ['image-resizer', 'passport-photo-maker', 'background-remover', 'crop-image'],
  },
  {
    slug: 'signature-resizer',
    category: 'image',
    name: 'Signature resizer',
    title: 'Signature Resizer: resize a signature to 10–20 KB for forms',
    h1: 'Signature *resizer*',
    description: 'Resize a scanned or photographed signature to the size an online form wants, such as 140 × 60 px and 10–20 KB, as a JPG. Edit any number. No upload.',
    tagline: 'A clean, correctly sized signature JPG for any upload form.',
    keywords: ['signature resizer', 'resize signature 10kb to 20kb', 'signature size 140x60', 'signature resize for online form', 'signature compress 20kb', 'sign resize'],
    island: 'ImageResizer',
    props: { mode: 'target', rangeKb: [10, 20], unit: 'px', w: 140, h: 60, forms: true },
    variantOf: 'image-resizer',
    steps: [
      'Sign on plain white paper with a dark pen, photograph or scan it, and crop close around the signature.',
      'Drop the picture in. It starts at 140 × 60 px and 10–20 KB; change the numbers to the ones your form gives.',
      'Check the result line, then download the JPG and upload it.',
    ],
    faq: [
      {
        q: 'How do I get a clean signature picture?',
        a: 'Use black or dark blue ink on white paper, take the photo in daylight without a shadow, and crop tightly so the signature fills most of the frame. Many forms reject signatures in capital letters, so sign as you normally would.',
      },
      {
        q: 'Why is padding added to my signature?',
        a: 'A small signature compresses to just a few KB even at the best quality, which is below many forms\' minimum. The tool adds blank padding inside the JPG to reach the minimum, without changing a single pixel, and the result line tells you how much.',
      },
      specsVary,
      filePrivacyFaq,
    ],
    related: ['exam-photo-signature-resizer', 'sign-pdf', 'image-resizer', 'crop-image'],
  },
  {
    slug: 'compress-pdf-for-online-application',
    category: 'pdf',
    name: 'Compress PDF for online forms',
    title: 'Compress PDF for Online Application Forms: 100–500 KB',
    h1: 'Compress PDF for *online forms*',
    description: 'Shrink certificates, ID proofs and mark sheets to the PDF size an online application allows, such as 100, 200 or 300 KB. Each result is checked. No upload.',
    tagline: 'Certificates and ID proofs, under the limit printed next to the upload box.',
    keywords: ['compress pdf for online application', 'pdf size reducer for govt form', 'compress certificate pdf', 'pdf size kam kare', 'reduce pdf size for upload', 'compress pdf for scholarship form'],
    island: 'CompressPdf',
    props: { targetKb: 200, targets: [100, 200, 300, 500] },
    variantOf: 'compress-pdf',
    steps: [
      'Find the size limit next to the upload box or in the notice, and set it here (it starts at 200 KB).',
      'Drop in your documents. Each one is compressed to the sharpest version under the limit, one file at a time.',
      'Check every result line says "✓ fits", then download the files and upload them one by one.',
    ],
    faq: [
      {
        q: 'Which documents usually need this?',
        a: 'Scanned certificates, mark sheets, caste or income certificates, ID and address proofs, and signed declarations. Scans are photos of paper, which is why they are big; typed PDFs are usually small already.',
      },
      {
        q: 'My scan won\'t go under 100 KB. What can I do?',
        a: 'Scan only the pages the form asks for, try the grayscale option (many forms accept black-and-white scans, but check yours), or split a long document if the portal lets you upload parts. The result line explains what stopped it.',
      },
      {
        q: 'Will the document still be readable?',
        a: 'The tool always tries the sharpest settings first and only lowers resolution as far as the limit needs. At the smallest sizes, zoom in on the result and check the small print before you submit.',
      },
      specsVary,
      filePrivacyFaq,
    ],
    related: ['compress-pdf', 'jpg-to-pdf-under-200kb', 'merge-pdf', 'exam-photo-signature-resizer'],
  },
] satisfies Tool[];

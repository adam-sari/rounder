import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'qr-code-scanner',
  category: 'everyday',
  name: 'QR code scanner',
  title: 'QR Code Scanner: scan with your camera or from an image',
  h1: 'QR code *scanner*',
  description: 'Scan QR codes and barcodes with your camera, or from a photo or screenshot. See links in full before opening, plus Wi-Fi logins and contacts.',
  tagline: 'Read any code from your camera or a screenshot, and see exactly where a link goes before you open it.',
  keywords: ['qr code reader', 'scan qr code from image', 'scan qr code from screenshot', 'qr scanner online', 'barcode scanner online', 'scan qr code on pc', 'wifi qr code scanner', 'scan qr code with webcam'],
  island: 'QrScanner',
  steps: [
    'Start your camera and point it at a code, or drop in, choose or paste a photo or screenshot.',
    'Every code in view is read, QR codes and barcodes alike, and shown by type: link, Wi-Fi, contact, email and more.',
    'Copy what you need. Links are shown in full and only open after you confirm.',
  ],
  faq: [
    { q: 'Can I scan a QR code from a screenshot or photo?', a: 'Yes. Drop in, choose or paste (Ctrl+V or ⌘V) an image. Every code in it is found, even several at once, and each one is numbered on the picture so you can tell them apart.' },
    { q: 'Is it safe to scan QR codes?', a: 'A code is only text, so reading it is harmless. The risk is where a link leads. This scanner never opens links by itself: it shows the whole address with the site name in bold, points out warning signs like short links, bare IP addresses and lookalike characters, and asks before opening anything.' },
    { q: 'Which codes can it read?', a: 'QR and Micro QR codes, Data Matrix, Aztec and PDF417, plus barcodes such as EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, Code 93, Codabar, ITF and DataBar. Reading is done by ZXing-C++, a widely used open-source barcode engine.' },
    { q: 'Why won\'t the camera start?', a: 'Your browser asks for permission the first time. If it was blocked, allow the camera for this site in your browser settings. A camera that another app is using can\'t be shared, so close it there first. The video is read frame by frame on your device and is never recorded or sent anywhere.' },
    filePrivacyFaq,
  ],
  related: ['qr-code-generator', 'barcode-generator', 'crop-image'],
} satisfies Tool;

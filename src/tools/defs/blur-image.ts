import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'blur-image',
  category: 'image',
  name: 'Blur faces & regions',
  title: 'Blur Faces in Photos: blur, pixelate or black out, free',
  h1: 'Blur faces & *regions*',
  description: 'Blur faces, license plates, names and screens in a photo. Auto-detect faces, then blur, pixelate or black out any area. Free and nothing is uploaded.',
  tagline: 'Hide faces, plates, names and screens before you share a photo.',
  keywords: ['blur face', 'blur faces in photo', 'pixelate image', 'blur license plate', 'censor image', 'redact photo', 'blur part of image', 'anonymize photo', 'face blur'],
  island: 'BlurImage',
  steps: [
    'Drop in a photo (JPG, PNG, WebP or HEIC), then press Auto-detect faces to mark them.',
    'Drag over anything else you want hidden (or press Add shape), then move or resize the shapes to fit.',
    'Pick blur, pixelate or a black box, set the strength and download the full-size image.',
  ],
  faq: [
    { q: 'Will it find every face?', a: 'Not always. Auto-detect works best on faces that look toward the camera. It also scans zoomed-in parts of the photo to catch small faces in group shots, but faces in profile, partly hidden or very far away can be missed, so check the result and drag over any it skipped.' },
    { q: 'Which effect hides things most safely?', a: 'A black box. It replaces the pixels completely, so nothing can be recovered. A light blur or small pixel blocks can sometimes leave text or faces guessable, so turn the strength up for anything sensitive, and use a black box for passwords, ID numbers and documents.' },
    { q: 'Does it remove the photo\'s metadata too?', a: 'Yes. The saved image is re-encoded from the pixels, so EXIF data such as GPS location, camera model and date taken is not carried over.' },
    { q: 'Does it lower the resolution?', a: 'No. The preview is scaled down to stay fast, but the download is made from the original full-size image with the effects applied at full resolution.' },
    filePrivacyFaq,
  ],
  related: ['exif-remover', 'crop-image', 'watermark-image', 'passport-photo-maker'],
} satisfies Tool;

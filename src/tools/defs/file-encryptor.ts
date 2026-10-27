import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'file-encryptor',
  category: 'files',
  name: 'Encrypt & decrypt files',
  title: 'Encrypt Files with a Password: AES-256, free, in your browser',
  h1: 'Encrypt & decrypt *files*',
  description: 'Lock any file with a password using AES-256-GCM, right in your browser. No upload, no size limit, and an open, documented file format.',
  tagline: 'Password-protect any file with AES-256. It never leaves your device.',
  keywords: ['encrypt file', 'password protect file', 'aes 256 encryption', 'decrypt file', 'encrypt file online', 'file encryption', 'lock file with password', 'secure file'],
  island: 'FileEncryptor',
  steps: [
    'Drop any file. Files ending in .rndr open in decrypt mode automatically.',
    'Choose a strong password and type it twice.',
    'Download the encrypted .rndr file. Decrypt it here later with the same password.',
  ],
  faq: [
    {
      q: 'How strong is the encryption?',
      a: 'Files are encrypted with AES-256-GCM using your browser\'s built-in Web Crypto. The key comes from your password through PBKDF2-SHA256 with 600,000 iterations and a random salt, which makes every password guess slow. The real weak point is the password, so use a long one: four or more random words works well.',
    },
    {
      q: 'What if I forget the password?',
      a: 'The file can\'t be recovered. There is no reset, no back door and no copy on our side, because nothing was ever sent to us. Keep the password in a password manager.',
    },
    {
      q: 'Is there a size limit?',
      a: 'No limit from us. Files are encrypted in 4 MB chunks, so even very large files work. In Chrome and Edge, files over 200 MB are written straight to disk as they are processed; other browsers build the result in memory, so the practical limit there is your device\'s RAM.',
    },
    {
      q: 'What is the .rndr format? Am I locked in?',
      a: 'It\'s simple and documented, so any developer can write a decrypter. A 60-byte header: "RNDR", version (1), KDF id (1 = PBKDF2-HMAC-SHA256), 2 reserved bytes, iterations (uint32), chunk size (uint32), 16-byte salt, 12-byte nonce, and a 16-byte key check (first half of SHA-256 of "RNDR key check" + key). Then chunks of AES-256-GCM ciphertext with a 16-byte tag. Chunk i uses the nonce with its last 4 bytes XORed with i, and authenticates the header + i (uint32) + a final-chunk flag byte, so missing, reordered or cut-off chunks are detected. All integers are big-endian; the password is UTF-8 in NFC form.',
    },
    {
      q: 'Does it hide the file name?',
      a: 'The contents are encrypted, but the file is named after the original (report.pdf becomes report.pdf.rndr) so you can tell your files apart. Rename it before sharing if the name itself is sensitive; decryption doesn\'t depend on it.',
    },
    filePrivacyFaq,
  ],
  related: ['password-generator', 'zip-files', 'checksum-calculator', 'protect-pdf'],
} satisfies Tool;

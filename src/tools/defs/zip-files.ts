import { LIMITS, MEASURED } from '../lib/notes';
import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'zip-files',
  category: 'files',
  name: 'Create a ZIP file',
  title: 'Zip Files Online: make a ZIP from files & folders, free',
  h1: 'Create a *ZIP* file',
  description: 'Zip files and whole folders right in your browser. Choose the compression level, see how much you save, and download your ZIP. Nothing is uploaded.',
  tagline: 'Pack files and folders into one tidy ZIP, without uploading a thing.',
  keywords: ['zip files online', 'create zip file', 'compress files to zip', 'zip a folder', 'make zip file', 'compress folder', 'zip maker', 'zip files free'],
  island: 'ZipFiles',
  steps: [
    'Drop in files or whole folders, or use the buttons to choose them.',
    'Name the archive and pick a compression level: store, normal or max.',
    'Click Create to zip it on your device and download it, with the space saved shown.',
  ],
  faq: [
    {
      q: 'Which compression level should I pick?',
      a: 'Normal suits almost everything: it compresses documents, code and text, and stores photos, videos and other archives as they are, since those barely shrink. Max squeezes harder but is slower. Store skips compression, which is quickest.',
    },
    {
      q: 'Why didn\'t my photos or videos get smaller?',
      a: 'JPG, PNG, MP4 and most other media formats are already compressed, so zipping them saves little or nothing. The ZIP is still handy for sending many files as one.',
    },
    {
      q: 'Can I put a password on the ZIP?',
      a: 'Not with this tool. To keep the contents private, run the finished ZIP through the file encryptor, which locks it with a password on your device.',
    },
    {
      q: 'Is there a size limit?',
      a: 'There\'s no cap from us. A standard ZIP holds up to 4 GB and 65,535 files; beyond that, split your files into a few archives. Large archives also need enough free memory on your device.',
    },
    filePrivacyFaq,
  ],
  notes: {
    settings: [
      { name: 'Compression: store', effect: 'No compression at all: the fastest, and right for photos and videos, which barely shrink anyway.' },
      { name: 'Compression: normal (default)', effect: 'Deflates documents, code and text; photos, videos and other archives are stored as they are, since squeezing them again wastes time.' },
      { name: 'Compression: max', effect: 'Squeezes every file as hard as Deflate can. Slower, and usually only a little smaller than normal.' },
      { name: 'Leave out system files', effect: 'Skips .DS_Store, Thumbs.db and similar clutter that macOS and Windows leave in folders. Shown only when there is some.' },
    ],
    results: [
      { input: '5 files, 18 MB: a JPG photo, a WAV song, two PDFs and a text file', setting: 'Normal', output: '16 MB zip', note: '−9%, 1.2 s: already-compressed files such as JPG and PDF barely shrink' },
      { input: 'The same 5 files', setting: 'Max', output: '16 MB zip', note: 'only 15 KB smaller than normal, 2.0 s' },
    ],
    measured: MEASURED,
    formats: [
      { name: 'ZIP', about: 'Opens on Windows, macOS, Linux, iOS and Android without extra software. Folders you drop keep their structure inside.' },
      { name: 'Size ceiling', about: 'A standard ZIP holds up to 4 GB or 65,535 files. Bigger archives need ZIP64, which this tool doesn\'t write yet, so split the files into a few ZIPs.' },
    ],
    limits: [LIMITS.gmail, LIMITS.outlook],
  },
  related: ['unzip-files', 'file-encryptor', 'image-compressor'],
  next: ['file-encryptor'],
} satisfies Tool;

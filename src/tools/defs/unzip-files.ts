import { filePrivacyFaq, type Tool } from '../types';

export default {
  slug: 'unzip-files',
  category: 'files',
  name: 'Unzip / extract ZIP, RAR, 7z',
  title: 'Unzip Files Online: open ZIP, RAR, 7z & TAR, no upload',
  h1: 'Unzip *files*',
  description: 'Open ZIP, RAR, 7z, TAR, GZ, BZ2 and XZ archives in your browser. Preview files, download just what you need, or extract it all. Nothing is uploaded.',
  tagline: 'Peek inside ZIP, RAR and 7z archives and pull out exactly what you need.',
  keywords: ['unzip online', 'extract zip', 'open rar file', 'extract rar online', 'open 7z file', 'extract tar.gz', 'unrar', 'zip extractor', 'open zip on chromebook', 'rar to zip'],
  island: 'Unzip',
  steps: [
    'Drop in an archive: ZIP, RAR, 7z, TAR, TAR.GZ, GZ, BZ2 or XZ. Enter the password if it has one.',
    'Browse the folders, search by name and click any image, text file or clip to preview it.',
    'Download single files, tick the ones you want as a new ZIP, or extract everything into a folder.',
  ],
  faq: [
    {
      q: 'Which formats can it open?',
      a: 'ZIP, RAR (versions 4 and 5), 7z, TAR, TAR.GZ / TGZ, TAR.BZ2, TAR.XZ, and single GZ, BZ2 and XZ files, plus ISO and CAB. Files that are ZIPs under another name, like JAR, APK, EPUB and DOCX, open too.',
    },
    {
      q: 'Can it open password-protected archives?',
      a: 'Yes for ZIP and 7z: enter the password and it is used only on your device. Encrypted RAR files aren\'t supported yet, and split archives (.part1.rar, .7z.001) need joining with a desktop app first.',
    },
    {
      q: 'How does "Extract to a folder" work?',
      a: 'In Chrome, Edge and other Chromium browsers on a computer, you pick a folder and the files are written straight into it, subfolders and all. Other browsers don\'t allow that yet, so there you download the files as a ZIP instead.',
    },
    {
      q: 'Can I convert a RAR or 7z file to ZIP?',
      a: 'Yes. Open the RAR or 7z file, then choose "Download all as .zip". You get a regular ZIP with the same folders that opens anywhere.',
    },
    {
      q: 'Is there a size limit?',
      a: 'There\'s no cap from us. The archive is unpacked in your browser\'s memory, so archives up to about 1.8 GB work (single GZ files can be larger). For bigger ones, a desktop app is the better tool.',
    },
    filePrivacyFaq,
  ],
  related: ['zip-files', 'file-encryptor', 'checksum-calculator'],
  flagship: { elsewhere: 'Uploads your archive, with size limits', here: 'Opened on your device, no upload' },
} satisfies Tool;

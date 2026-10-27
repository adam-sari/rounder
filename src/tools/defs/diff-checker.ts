import { privacyFaq, type Tool } from '../types';

export default {
  slug: 'diff-checker',
  category: 'text',
  name: 'Diff checker',
  title: 'Diff Checker: compare two texts or files online, side by side',
  h1: 'Diff *checker*',
  description: 'Compare two texts or files and see every change, side by side or unified, with word and character highlights. Copy a patch. Nothing is uploaded.',
  tagline: 'Paste two versions and see exactly what changed, down to the word.',
  keywords: ['diff checker', 'compare text', 'text compare', 'compare two files', 'find difference between two texts', 'online diff', 'diffchecker', 'compare code'],
  island: 'DiffChecker',
  steps: [
    'Paste the original text on the left and the changed version on the right, or drop a file onto either side.',
    'Pick side by side or unified, and whether to highlight changed words or characters. Ignore whitespace or case if they don\'t matter.',
    'Jump between changes with the arrows (or N and P), then copy or download the result as a unified patch.',
  ],
  faq: [
    { q: 'What do the colors mean?', a: 'Red lines were removed from the original and green lines were added in the changed version. When a line was edited rather than replaced, the exact words or characters that changed get a stronger highlight.' },
    { q: 'Can I compare big files?', a: 'Yes. The comparison runs in a background thread, so files with tens of thousands of lines stay responsive, and long runs of unchanged lines are folded away. There is no file size cap from us; very large files are limited only by your device\'s memory.' },
    { q: 'What does "ignore whitespace" do?', a: 'Lines that differ only in indentation, trailing spaces or the number of spaces between words count as unchanged. Line endings (Windows vs Unix) and a missing final newline are always ignored, and the tool tells you when line endings differ.' },
    { q: 'What is the patch for?', a: 'A unified diff (.diff or .patch) is the standard format used by Git and code review tools. It always describes the exact texts, line endings included, so it applies cleanly with the patch command even if you chose to ignore whitespace or case on screen.' },
    privacyFaq,
  ],
  related: ['compare-pdf', 'remove-duplicate-lines', 'word-counter', 'json-formatter'],
} satisfies Tool;

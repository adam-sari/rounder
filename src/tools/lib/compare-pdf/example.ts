import { loadPdfLibModule, savePdf } from '@/engines/pdf';

interface Page {
  title: string;
  lines: string[];
  /** a colored box, so the visual comparison has something to find */
  box?: [number, number, number];
}

const ORIGINAL: Page[] = [
  { title: 'Night Workshop handbook', lines: ['A shared space for makers, fixers and tinkerers.', 'Edition 3, spring.'], box: [1, 0.82, 0.37] },
  { title: 'Opening hours', lines: ['Monday to Friday: 9am to 6pm.', 'Saturday: 10am to 4pm.', 'Sunday: closed.', 'Members can book the laser cutter up to a week ahead.'] },
  { title: 'Bench rules', lines: ['Bring your own tools, or borrow ours.', 'Wear eye protection near the lathe.', 'Please clean up your bench before leaving.'] },
];

const CHANGED: Page[] = [
  { title: 'Night Workshop handbook', lines: ['A shared space for makers, fixers and tinkerers.', 'Edition 4, autumn.'], box: [0.37, 0.77, 1] },
  { title: 'Opening hours', lines: ['Monday to Friday: 9am to 8pm.', 'Saturday: 10am to 4pm.', 'Sunday: 12pm to 4pm.', 'Members can book the laser cutter up to two weeks ahead.'] },
  { title: 'Tool library', lines: ['Borrow drills, saws and sanders for up to three days.', 'Return them clean and charged.'] },
  { title: 'Bench rules', lines: ['Bring your own tools, or borrow ours.', 'Wear eye protection near the lathe.', 'Please clean up your bench before leaving.'] },
];

async function build(pages: Page[], name: string) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLibModule();
  const doc = await PDFDocument.create();
  const [regular, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  for (const p of pages) {
    const page = doc.addPage([595, 842]);
    page.drawText(p.title, { x: 64, y: 740, size: 28, font: bold });
    p.lines.forEach((line, i) => page.drawText(line, { x: 64, y: 690 - i * 26, size: 14, font: regular }));
    if (p.box) page.drawRectangle({ x: 64, y: 380, width: 467, height: 160, color: rgb(...p.box) });
  }
  return new File([await savePdf(doc)], name, { type: 'application/pdf' });
}

/** Two small PDFs that differ in text, an inserted page and a recolored box */
export const examplePdfs = () => Promise.all([build(ORIGINAL, 'handbook-spring.pdf'), build(CHANGED, 'handbook-autumn.pdf')]);

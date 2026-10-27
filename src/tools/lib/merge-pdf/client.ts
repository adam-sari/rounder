import * as Comlink from 'comlink';
import { decodeImage, encodeImage, imageKind } from '@/engines/image/client';
import { abortError, DAMAGED, isAbort, PdfError, runQpdf } from '@/engines/pdf';
import { hasAlpha, jpegOrientation, ORIENTATION_ROTATION } from './image';
import type { MergeOptions, PlanPage } from './merge';
import type { MergeProgress, MergeWorker } from './worker';

export type { MergeOptions, PlanPage };
export type Progress = { stage: 'reading'; done: number; total: number; name: string } | MergeProgress;

function spawn() {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'merge-pdf' });
  // a worker that fails to load never answers: fail its calls instead of hanging
  const crashed = new Promise<never>((_, reject) =>
    worker.addEventListener('error', () => reject(new PdfError("The PDF engine couldn't start. Reload the page and try again."))),
  );
  crashed.catch(() => {});
  return { worker, api: Comlink.wrap<MergeWorker>(worker), crashed };
}

/* ---------------- images → one-page PDFs (for thumbnails now, merging later) ---------------- */

let helper: ReturnType<typeof spawn> | undefined;

export function disposeHelper() {
  helper?.worker.terminate();
  helper = undefined;
}

const UNREADABLE = "This image couldn't be read. It may be damaged, or in a format your browser can't open.";

/** JPG and PNG go in as they are (no recompression); other formats are decoded and re-encoded first */
export async function imageAsPdf(file: File): Promise<Uint8Array> {
  const kind = await imageKind(file);
  if (kind === 'unknown') throw new PdfError(UNREADABLE);
  const h = (helper ??= spawn());
  const run = (bytes: Uint8Array, type: 'jpeg' | 'png', rotation: number) =>
    Promise.race([h.api.imagePdf(Comlink.transfer(bytes, [bytes.buffer]), type, rotation), h.crashed]).catch((e) => {
      // a crashed helper stays broken: drop it so the next image starts a fresh one
      if (e instanceof PdfError && helper === h) disposeHelper();
      throw e;
    });

  if (kind === 'jpeg' || kind === 'png') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const rotation = kind === 'jpeg' ? ORIENTATION_ROTATION[jpegOrientation(bytes)] : 0;
    // mirrored camera orientations can't be shown with a page rotation, so those get redrawn
    if (rotation !== undefined) {
      try {
        return await run(bytes, kind, rotation);
      } catch (e) {
        if (e instanceof PdfError) throw e;
        // an unusual JPG/PNG variant pdf-lib can't embed: redraw it below
      }
    }
  }
  let img: ImageData;
  try {
    img = await decodeImage(file);
  } catch {
    throw new PdfError(UNREADABLE);
  }
  const type = hasAlpha(img.data) ? 'png' : 'jpeg';
  const blob = await encodeImage(img, { format: type, quality: 92 });
  return run(new Uint8Array(await blob.arrayBuffer()), type, 0);
}

/* ---------------- merging ---------------- */

export interface MergeInput {
  /** PdfDoc.id, as used in the plan */
  id: string;
  name: string;
  file: Blob;
  /** the open password, if it had one */
  password?: string;
  /** page count pdf.js found, to catch files pdf-lib misreads */
  pages: number;
}

const named = (name: string, e: unknown) => (e instanceof PdfError ? new PdfError(`${name}: ${e.message}`, e.kind) : e);

/**
 * Merges in a worker of its own, so even a 500-page merge leaves the page
 * responsive. Encrypted files are unlocked (and broken ones repaired) with qpdf
 * first. Aborting stops the worker at once.
 */
export async function mergePdfs(inputs: MergeInput[], plan: PlanPage[], opts: MergeOptions, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Blob> {
  const { worker, api, crashed } = spawn();
  const stopped = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }));
  stopped.catch(() => {});
  const race = <T>(p: Promise<T>) => Promise.race([p, crashed, stopped]);
  try {
    for (const [i, src] of inputs.entries()) {
      onProgress({ stage: 'reading', done: i, total: inputs.length, name: src.name });
      let status = await race(api.load(src.id, src.file, src.pages));
      if (status === 'ok') continue;
      let fixed: Uint8Array;
      try {
        const bytes = new Uint8Array(await src.file.arrayBuffer());
        fixed = await race(runQpdf(status === 'encrypted' ? ['--decrypt', 'in.pdf', 'out.pdf'] : ['in.pdf', 'out.pdf'], bytes, { password: src.password }));
      } catch (e) {
        throw named(src.name, e);
      }
      status = await race(api.load(src.id, Comlink.transfer(fixed, [fixed.buffer]), src.pages));
      if (status !== 'ok') throw new PdfError(`${src.name}: ${DAMAGED}`, 'damaged');
    }
    // Comlink posts the callback's return value back to the worker; a caller returning its $state proxy
    // (e.g. `(p) => (progress = p)`) can't be cloned, and the worker reports that as an unhandled rejection
    const bytes = await race(api.merge(plan, opts, Comlink.proxy((p: MergeProgress) => void onProgress(p))));
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  } catch (e) {
    if (e instanceof PdfError || isAbort(e)) throw e;
    const msg = String((e as Error)?.message ?? e);
    if (/memory|allocation/i.test(msg)) throw new PdfError("This merge is too big for your browser's memory. Try closing other tabs, or merging in smaller batches.");
    throw new PdfError(`The merge failed (${msg}).`);
  } finally {
    worker.terminate();
  }
}

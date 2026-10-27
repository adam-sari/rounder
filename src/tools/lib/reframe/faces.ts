import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
// self-hosted: the MediaPipe engine comes from our own origin, never a CDN
import simdLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import simdBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import plainLoader from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import plainBinary from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';
import { fetchModelFile } from '@/engines/ai/load';
import { ProgressTally, type OnProgress } from '@/engines/ai/progress';
import { fetchCached } from '@/engines/ai/storage';
import { ENGINE_BYTES, FULL_RANGE, SHORT_RANGE as SHORT } from './models';
import { mergeBoxes, squareTiles, type Box } from './signal';

/*
 * Face detection for auto-reframe: MediaPipe BlazeFace short-range (close-ups, from the shared
 * registry) plus full-range (people further from the camera, self-hosted next to this tool).
 * Full range also looks at two overlapping square tiles of wide frames, where faces are bigger.
 */

const MIN_SCORE = 0.5;
/** the full-range model looks at 192 × 192; tiles don't need more pixels than twice that */
const TILE_PX = 384;

export interface Detector {
  /** faces in 0–1 frame units, merged across models and tiles */
  detect(frame: ImageBitmap): Box[];
}

let pending: Promise<Detector> | null = null;

/** Downloads (once, cached) and starts both detectors; progress covers the models and the engine */
export function loadDetector(o: { onProgress?: OnProgress; signal?: AbortSignal } = {}): Promise<Detector> {
  pending ??= create(o).catch((e) => {
    pending = null;
    throw e;
  });
  return pending;
}

async function create({ onProgress, signal }: { onProgress?: OnProgress; signal?: AbortSignal }): Promise<Detector> {
  const simd = await FilesetResolver.isSimdSupported();
  const wasmUrl = simd ? simdBinary : plainBinary;
  const tally = new ProgressTally({ [SHORT.path]: SHORT.bytes, [FULL_RANGE.path]: FULL_RANGE.bytes, [wasmUrl]: simd ? ENGINE_BYTES.simd : ENGINE_BYTES.plain });
  const report = (file: string) => (n: number, t?: number) => onProgress?.(tally.update(file, n, t));
  const [short, full, wasm] = await Promise.all([
    fetchModelFile('face-detector', { signal, onProgress: (p) => onProgress?.(tally.update(SHORT.path, p.loaded, p.total)) }),
    fetchCached(FULL_RANGE.path, { bytes: FULL_RANGE.bytes, signal, onProgress: report(FULL_RANGE.path) }),
    fetchCached(wasmUrl, { signal, onProgress: report(wasmUrl) }),
  ]);
  onProgress?.({ ...tally.sum(), phase: 'init' });

  const binary = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
  const fileset = { wasmLoaderPath: simd ? simdLoader : plainLoader, wasmBinaryPath: binary };
  const make = (model: Uint8Array) =>
    FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: MIN_SCORE });
  try {
    const near = await make(short);
    // full range needs a recent MediaPipe; without it, close-ups still work. An engine without
    // full-range anchors builds the detector but fails on the first frame, so try one first.
    const far = await make(full)
      .then((fd) => {
        const probe = new OffscreenCanvas(64, 64);
        probe.getContext('2d')!.fillRect(0, 0, 64, 64);
        try {
          fd.detect(probe);
          return fd;
        } catch (e) {
          fd.close();
          throw e;
        }
      })
      .catch((e) => {
        console.warn('Full-range face model unavailable', e);
        return null;
      });
    return { detect: (frame) => detectAll(frame, near, far) };
  } finally {
    URL.revokeObjectURL(binary);
  }
}

let tile: OffscreenCanvas | null = null;

function detectAll(frame: ImageBitmap, near: FaceDetector, far: FaceDetector | null): Box[] {
  const W = frame.width;
  const H = frame.height;
  const found: Box[] = [];
  const collect = (fd: FaceDetector, src: ImageBitmap | OffscreenCanvas, ox: number, oy: number, scale: number) => {
    for (const d of fd.detect(src).detections) {
      const bb = d.boundingBox;
      if (!bb) continue;
      found.push({ x: (ox + bb.originX / scale) / W, y: (oy + bb.originY / scale) / H, w: bb.width / scale / W, h: bb.height / scale / H, score: d.categories[0]?.score ?? 0 });
    }
  };
  collect(near, frame, 0, 0, 1);
  if (far) {
    collect(far, frame, 0, 0, 1);
    for (const t of squareTiles(W, H)) {
      const s = Math.min(1, TILE_PX / t.size);
      const side = Math.max(1, Math.round(t.size * s));
      tile ??= new OffscreenCanvas(side, side);
      tile.width = tile.height = side;
      const ctx = tile.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(frame, t.x, t.y, t.size, t.size, 0, 0, side, side);
      collect(far, tile, t.x, t.y, side / t.size);
    }
  }
  return mergeBoxes(found);
}

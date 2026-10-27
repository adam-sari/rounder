import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
// self-hosted so detection works offline and nothing is fetched from a CDN
import simdLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import simdBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import plainLoader from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import plainBinary from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';
import { cutByTile, detectionTiles, mergeDetections, padFace, type Box } from './regions';

const MODEL = '/models/blaze_face_short_range.tflite';
/** the model looks at 128 × 128, so tiles don't need to be drawn any bigger than this */
const TILE_PX = 384;
const FULL_PX = 640;

let detector: Promise<FaceDetector> | undefined;

function load() {
  detector ??= (async () => {
    const simd = await FilesetResolver.isSimdSupported();
    return FaceDetector.createFromOptions(
      { wasmLoaderPath: simd ? simdLoader : plainLoader, wasmBinaryPath: simd ? simdBinary : plainBinary },
      { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.55 },
    );
  })().catch((err) => {
    detector = undefined;
    throw err;
  });
  return detector;
}

/** Finds faces in the whole image and in zoomed-in tiles, returning padded boxes in image pixels */
export async function findFaces(img: ImageBitmap, onProgress?: (fraction: number) => void): Promise<Box[]> {
  const fd = await load();
  const W = img.width;
  const H = img.height;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const passes = [{ x: 0, y: 0, w: W, h: H }, ...detectionTiles(W, H)];
  const found: (Box & { score: number })[] = [];

  for (const [i, t] of passes.entries()) {
    const s = Math.min(1, (i ? TILE_PX : FULL_PX) / Math.max(t.w, t.h));
    canvas.width = Math.max(1, Math.round(t.w * s));
    canvas.height = Math.max(1, Math.round(t.h * s));
    // resizing the canvas resets this; low-quality downscaling aliases small faces away
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, t.x, t.y, t.w, t.h, 0, 0, canvas.width, canvas.height);
    for (const d of fd.detect(canvas).detections) {
      const bb = d.boundingBox;
      if (!bb) continue;
      const box = { x: t.x + bb.originX / s, y: t.y + bb.originY / s, w: bb.width / s, h: bb.height / s };
      if (i && cutByTile(box, t, W, H)) continue;
      found.push({ ...box, score: d.categories[0]?.score ?? 0 });
    }
    onProgress?.((i + 1) / passes.length);
    // hand the main thread back between tiles so the page stays responsive
    await new Promise((resolve) => setTimeout(resolve));
  }
  return mergeDetections(found).map((b) => padFace(b, W, H));
}

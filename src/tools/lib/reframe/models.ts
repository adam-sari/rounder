import { getModel } from '@/engines/ai/models';

/*
 * What auto-reframe downloads. Kept apart from faces.ts so the page can quote sizes without
 * loading MediaPipe. The full-range model isn't in the shared registry yet, so it's self-hosted
 * under public/models/auto-reframe (from storage.googleapis.com/mediapipe-models/face_detector/
 * blaze_face_full_range/float16/1, sha256 3698b18f…181b, Apache-2.0).
 */

export const SHORT_RANGE = getModel('face-detector').variants.fp16.files[0];
export const FULL_RANGE = { path: '/models/auto-reframe/blaze_face_full_range.tflite', bytes: 1083786 };
/** MediaPipe's vision engine (.wasm), SIMD and plain builds */
export const ENGINE_BYTES = { simd: 13_519_922, plain: 12_627_509 };
/** the first run: both models and the engine (the model card counts only the short-range model) */
export const FIRST_RUN_BYTES = SHORT_RANGE.bytes + FULL_RANGE.bytes + ENGINE_BYTES.simd;

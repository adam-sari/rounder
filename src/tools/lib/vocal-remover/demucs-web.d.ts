// demucs-web 1.0.2 ships plain JS; these are the parts we use (see its README / src/processor.js).
declare module 'demucs-web' {
  type Stereo = { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> };
  interface SegmentProgress {
    progress: number;
    currentSegment: number;
    totalSegments: number;
  }
  export const CONSTANTS: { SAMPLE_RATE: number; TRAINING_SAMPLES: number; SEGMENT_OVERLAP: number; TRACKS: string[] };
  export class DemucsProcessor {
    constructor(options: { ort: typeof import('onnxruntime-web'); onProgress?: (p: SegmentProgress) => void });
    /** set directly when the session was created elsewhere (our cached, pinned loader) */
    session: import('onnxruntime-web').InferenceSession | null;
    onProgress: (p: SegmentProgress) => void;
    /** 44.1 kHz stereo in; ~7.8 s segments with 25% overlap, cross-faded */
    separate(left: Float32Array, right: Float32Array): Promise<Record<'drums' | 'bass' | 'other' | 'vocals', Stereo>>;
  }
}

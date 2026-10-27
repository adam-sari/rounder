import { bitmapToBlob, frameAt } from '@/engines/media';

/**
 * Still-frame preview for videos the <video> element can't play (MKV in Safari, a fallback
 * decoder's copy …). Frames are decoded on demand; while one decodes, only the latest
 * requested time is kept, so scrubbing never queues up work.
 */
export function stillFrames(file: Blob, size: { width?: number; height?: number }, onframe: (url: string) => void) {
  let url: string | null = null;
  let wanted: number | null = null;
  let running = false;
  let closed = false;

  async function pump() {
    running = true;
    while (wanted !== null && !closed) {
      const time = wanted;
      wanted = null;
      try {
        const bitmap = await frameAt(file, time, size);
        const blob = await bitmapToBlob(bitmap, 'image/jpeg', 0.85);
        bitmap.close();
        if (closed) break;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        onframe(url);
      } catch (e) {
        console.error(e); // keep showing the previous frame
      }
    }
    running = false;
  }

  return {
    show(time: number) {
      wanted = time;
      if (!running) void pump();
    },
    close() {
      closed = true;
      if (url) URL.revokeObjectURL(url);
    },
  };
}

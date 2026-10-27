import type { MediaErrorCode } from '@/engines/media/types';

const messages: Partial<Record<MediaErrorCode, string>> = {
  'unsupported-input': "We couldn't read this file. MP4, WebM and MOV work best; other formats may need converting first.",
  'unsupported-codec': "Your browser can't create this format. Try another output format.",
  'no-tracks': "This file has no video in it, so there's nothing to animate.",
  'no-webcodecs': "This browser can't decode video frames (it has no WebCodecs). Try a recent Chrome, Edge, Safari or Firefox.",
  'out-of-memory': 'Your browser ran out of memory. Try a shorter range or a smaller width.',
  'ffmpeg-failed': "The fallback decoder couldn't convert this file. It may be damaged or use a rare codec.",
};

/** a sentence for the user, or null when the job was simply cancelled */
export function friendlyError(e: unknown): string | null {
  const err = e as { code?: MediaErrorCode; message?: string } | undefined;
  if (err?.code === 'aborted' || (e as Error)?.name === 'AbortError') return null;
  return (err?.code && messages[err.code]) || err?.message || 'Something went wrong. Please try again.';
}

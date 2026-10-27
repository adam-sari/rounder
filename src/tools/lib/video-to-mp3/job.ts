/** Progress maths and error copy shared by the video-to-mp3 and frame extractor tools. */

/** seconds left, or null until there is enough of a run to judge */
export function etaSeconds(elapsedMs: number, progress: number): number | null {
  if (!(progress > 0.02) || elapsedMs < 1500) return null;
  if (progress >= 1) return 0;
  return (elapsedMs / progress - elapsedMs) / 1000;
}

/** 7 → "0:07", 65 → "1:05", 3723 → "1:02:03" */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** user-facing text for a MediaError (or anything else thrown) */
export function mediaErrorText(e: unknown): string {
  const { code, message } = (e ?? {}) as { code?: string; message?: string };
  switch (code) {
    case 'aborted':
      return 'Cancelled.';
    case 'unsupported-input':
      return "Your browser can't read this file. It may be damaged, or use a format we can't open.";
    case 'unsupported-codec':
      return "Your browser can't create this format. Pick another one and try again.";
    case 'ffmpeg-failed':
      return "The backup decoder couldn't convert this file. It may be damaged or use a very rare codec.";
    case 'no-tracks':
    case 'no-webcodecs':
    case 'out-of-memory':
    case 'invalid-options':
      return message || 'Something went wrong.';
    default:
      return message || 'Something went wrong while processing the file.';
  }
}

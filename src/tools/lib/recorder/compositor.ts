import { bubbleRect, canvasSize, centerSquare, containRect, type Bubble } from './layout';

export interface Compositor {
  /** the canvas being drawn, for a live preview */
  canvas: HTMLCanvasElement;
  /** the canvas as a video track, ready for MediaRecorder */
  track: MediaStreamTrack;
  setBubble: (b: Bubble) => void;
  stop: () => void;
}

async function playing(track: MediaStreamTrack) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = new MediaStream([track]);
  await v.play();
  if (!v.videoWidth) await new Promise((r) => v.addEventListener('resize', r, { once: true }));
  return v;
}

/**
 * Draws the screen with a round webcam bubble on top into a canvas, at `fps`. Ticks come from a
 * worker so drawing keeps pace while this tab is in the background; the canvas keeps the
 * screen's first size, and later size changes (a resized window) are letterboxed into it.
 */
export async function composite(screen: MediaStreamTrack, camera: MediaStreamTrack, o: { fps: number; bubble: Bubble }): Promise<Compositor> {
  const [screenVideo, camVideo] = await Promise.all([playing(screen), playing(camera)]);
  const canvas = document.createElement('canvas');
  const { width, height } = canvasSize(screenVideo.videoWidth, screenVideo.videoHeight);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  let bubble = o.bubble;

  const draw = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const r = containRect(screenVideo.videoWidth, screenVideo.videoHeight, width, height);
    ctx.drawImage(screenVideo, r.x, r.y, r.width, r.height);
    if (!camVideo.videoWidth || camera.readyState === 'ended') return;
    const b = bubbleRect(width, height, bubble);
    const s = centerSquare(camVideo.videoWidth, camVideo.videoHeight);
    const radius = b.size / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x + radius, b.y + radius, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(camVideo, s.x, s.y, s.size, s.size, b.x, b.y, b.size, b.size);
    ctx.restore();
    ctx.lineWidth = Math.max(2, b.size * 0.018);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(b.x + radius, b.y + radius, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
  };

  draw();
  const stream = canvas.captureStream(o.fps);
  const clock = new Worker(new URL('./tick-worker.ts', import.meta.url), { type: 'module', name: 'recorder-clock' });
  clock.onmessage = draw;
  clock.postMessage(1000 / o.fps);

  return {
    canvas,
    track: stream.getVideoTracks()[0],
    setBubble: (b) => {
      bubble = b;
      draw();
    },
    stop: () => {
      clock.terminate();
      stream.getTracks().forEach((t) => t.stop());
      screenVideo.srcObject = camVideo.srcObject = null;
    },
  };
}

import { backgroundGradient, captionColor, gradientLine, type Layout, type Settings } from './layout';

type Ctx = CanvasRenderingContext2D;

const FONT = '"Geist Variable", ui-sans-serif, system-ui, sans-serif';
const LIGHTS = ['#ff5f57', '#febc2e', '#28c840'];

const chrome = {
  light: { bar: '#ececec', line: 'rgba(0,0,0,0.09)', pill: '#ffffff', text: '#6b6b6b', border: 'rgba(0,0,0,0.14)' },
  dark: { bar: '#2b2a29', line: 'rgba(0,0,0,0.45)', pill: '#1c1b1a', text: '#a3a09a', border: 'rgba(255,255,255,0.16)' },
};

// canvas shadows ignore the transform, so they are given in output pixels
const shadows = {
  none: [],
  soft: [{ blur: 48, y: 18, alpha: 0.28 }],
  strong: [{ blur: 90, y: 36, alpha: 0.5 }, { blur: 10, y: 4, alpha: 0.25 }],
};

export interface RenderOptions {
  /** output px per layout px */
  scale: number;
  /** is the screenshot mostly dark (picks the inset border color when there's no frame) */
  darkShot: boolean;
  /** fill transparent areas with white (for JPG) */
  opaque?: boolean;
}

/** Draws the whole composition; the canvas must already be layout size × scale */
export function render(ctx: Ctx, img: CanvasImageSource, L: Layout, s: Settings, o: RenderOptions) {
  const { scale, darkShot } = o;
  const { frame, k } = L;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, L.width, L.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const g = backgroundGradient(s.background);
  if (g) {
    if (g.stops.length === 1) ctx.fillStyle = g.stops[0];
    else {
      const p = gradientLine(L.width, L.height, g.angle);
      const grad = ctx.createLinearGradient(p.x0, p.y0, p.x1, p.y1);
      g.stops.forEach((c, i) => grad.addColorStop(i / (g.stops.length - 1), c));
      ctx.fillStyle = grad;
    }
    ctx.fillRect(0, 0, L.width, L.height);
  } else if (o.opaque) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, L.width, L.height);
  }

  const c = chrome[s.theme];
  const windowPath = () => {
    ctx.beginPath();
    ctx.roundRect(frame.x, frame.y, frame.w, frame.h, L.radius);
  };

  for (const sh of shadows[s.shadow]) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${sh.alpha})`;
    ctx.shadowBlur = sh.blur * k * scale;
    ctx.shadowOffsetY = sh.y * k * scale;
    ctx.fillStyle = s.frame === 'none' ? '#ffffff' : c.bar;
    windowPath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  windowPath();
  ctx.clip();
  if (L.bar) drawBar(ctx, L, s, c);
  ctx.drawImage(img, L.shot.x, L.shot.y, L.shot.w, L.shot.h);
  ctx.restore();

  if (s.border) {
    const lw = Math.max(1 / scale, 1.25 * k);
    ctx.lineWidth = lw;
    ctx.strokeStyle = s.frame === 'none' ? (darkShot ? chrome.dark.border : chrome.light.border) : c.border;
    ctx.beginPath();
    ctx.roundRect(frame.x + lw / 2, frame.y + lw / 2, frame.w - lw, frame.h - lw, Math.max(0, L.radius - lw / 2));
    ctx.stroke();
  }

  if (L.caption) {
    const cap = L.caption;
    let size = cap.size;
    ctx.font = `500 ${size}px ${FONT}`;
    const text = s.caption.trim();
    const w = ctx.measureText(text).width;
    if (w > cap.maxWidth) {
      size *= cap.maxWidth / w;
      ctx.font = `500 ${size}px ${FONT}`;
    }
    ctx.fillStyle = captionColor(g);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cap.x, cap.y);
  }
}

function drawBar(ctx: Ctx, L: Layout, s: Settings, c: (typeof chrome)['light']) {
  const { frame, bar, k } = L;
  ctx.fillStyle = c.bar;
  ctx.fillRect(frame.x, frame.y, frame.w, bar);
  ctx.fillStyle = c.line;
  ctx.fillRect(frame.x, frame.y + bar - k, frame.w, k);

  const cy = frame.y + bar / 2;
  LIGHTS.forEach((color, i) => {
    ctx.beginPath();
    ctx.arc(frame.x + (20 + i * 20) * k, cy, 6 * k, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });

  if (s.frame !== 'browser') return;
  // the url pill sits centered, clear of the traffic lights
  const side = 96 * k;
  const pw = Math.min(frame.w * 0.62, frame.w - 2 * side);
  if (pw < 40 * k) return;
  const ph = 30 * k;
  ctx.beginPath();
  ctx.roundRect(frame.x + (frame.w - pw) / 2, cy - ph / 2, pw, ph, 8 * k);
  ctx.fillStyle = c.pill;
  ctx.fill();

  let url = s.url.trim();
  if (!url) return;
  ctx.font = `400 ${14 * k}px ${FONT}`;
  const room = pw - 24 * k;
  if (ctx.measureText(url).width > room) {
    while (url.length > 1 && ctx.measureText(`${url}…`).width > room) url = url.slice(0, -1);
    url += '…';
  }
  ctx.fillStyle = c.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(url, frame.x + frame.w / 2, cy + k);
}

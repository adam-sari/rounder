import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { contactSheetLayout } from '@/tools/lib/video-frame-extractor/frames';
import { RounderError, throwIfAborted } from '../core/errors';
import { withSuffix, type Source } from '../core/io';
import type { OptionsOut } from '../core/op';
import { FileOutput, tempPath } from '../core/output';
import { result, type Ctx, type OpResult } from '../core/run';
import type * as ops from '../ops/media';
import { ffPath, runFfmpeg } from '../platform/node/ffmpeg';
import { decodeBytes, encodeImage } from '../platform/node/image-client';
import { probeSource, seconds } from './media';

/** 3 × 5 pixel digits for the time labels, so no font (and no canvas package) is needed */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  ':': ['0', '1', '0', '1', '0'],
  '.': ['0', '0', '0', '0', '1'],
};

/** "1:02:05" past an hour, "2:05" otherwise, "0:01.4" when frames are under a second apart */
export function clock(t: number, long: boolean, tenths = false): string {
  const s = Math.floor(t);
  const frac = tenths ? `.${Math.floor((t - s) * 10)}` : '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return (long ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`) + frac;
}

function fill(img: ImageData, x: number, y: number, w: number, h: number, rgb: [number, number, number], alpha = 1) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(img.width, x + w);
  const y1 = Math.min(img.height, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * img.width + xx) * 4;
      img.data[i] += (rgb[0] - img.data[i]) * alpha;
      img.data[i + 1] += (rgb[1] - img.data[i + 1]) * alpha;
      img.data[i + 2] += (rgb[2] - img.data[i + 2]) * alpha;
      img.data[i + 3] = 255;
    }
  }
}

/** a time label in the tile's bottom-left corner: light digits on a dark plate */
function label(img: ImageData, text: string, x: number, y: number, px: number) {
  const width = [...text].reduce((n, c) => n + (GLYPHS[c]?.[0].length ?? 3) + 1, -1) * px;
  const pad = 2 * px;
  fill(img, x, y - 5 * px - pad * 2, width + pad * 2, 5 * px + pad * 2, [20, 19, 18], 0.78);
  let cx = x + pad;
  for (const c of text) {
    const g = GLYPHS[c];
    if (!g) continue;
    g.forEach((row, ry) => [...row].forEach((on, rx) => on === '1' && fill(img, cx + rx * px, y - pad - 5 * px + ry * px, px, px, [244, 239, 230])));
    cx += (g[0].length + 1) * px;
  }
}

/**
 * Evenly spaced frames (the middle of each equal slice of the clip, so neither the black first frame nor the fade-out
 * last one) in a grid, each with its time. ffmpeg cuts and scales each frame; the grid is put together here.
 */
export async function contactSheet(inputs: Source[], o: OptionsOut<typeof ops.videoContactSheet>, ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const { path, info } = await probeSource(src);
  if (!info.video) throw new RounderError('unsupported-input', 'This file has no video track.');
  const duration = info.durationSec || 0;
  const start = Math.max(0, seconds(o.start, 'start') ?? 0);
  const end = Math.min(seconds(o.end, 'end') ?? duration, duration || Infinity);
  if (!(end > start)) throw new RounderError('invalid-options', duration ? `The end (${end}s) must come after the start (${start}s).` : "This video's length couldn't be read.");
  const n = Math.max(1, Math.min(o.frames, Math.floor((end - start) * 10) || 1));
  const times = Array.from({ length: n }, (_, i) => start + ((i + 0.5) * (end - start)) / n);
  const layout = contactSheetLayout(n, info.video.displayWidth, info.video.displayHeight, { columns: o.columns, width: o.width, gap: 8, pad: 16, maxSide: 8192, maxArea: 40_000_000 });
  const sheet = new ImageData(layout.width, layout.height);
  fill(sheet, 0, 0, layout.width, layout.height, [20, 19, 18]);
  const long = end >= 3600;
  const px = Math.max(1, Math.round(layout.tileHeight / 70));
  const tmp = tempPath(tmpdir(), 'png');
  let missed = 0;
  try {
    for (const [i, t] of times.entries()) {
      throwIfAborted(ctx.signal);
      ctx.progress({ stage: 'frames', done: i, total: n });
      // -ss before -i seeks fast to the nearest keyframe, then decodes forward to the exact time
      await runFfmpeg(['-y', '-ss', t.toFixed(3), '-i', ffPath(path), '-frames:v', '1', '-vf', `scale=${layout.tileWidth}:${layout.tileHeight}:flags=lanczos`, '-an', '-c:v', 'png', ffPath(tmp)], { signal: ctx.signal });
      let frame: ImageData;
      try {
        frame = await decodeBytes(new Uint8Array(await readFile(tmp)), 'png');
      } catch {
        missed++;
        continue;
      }
      const { x, y } = layout.cells[i];
      for (let row = 0; row < Math.min(frame.height, layout.tileHeight); row++) {
        const from = row * frame.width * 4;
        sheet.data.set(frame.data.subarray(from, from + Math.min(frame.width, layout.tileWidth) * 4), ((y + row) * layout.width + x) * 4);
      }
      if (o.timestamps) label(sheet, clock(t, long, (end - start) / n < 1), x + 3 * px, y + layout.tileHeight - 3 * px, px);
      await rm(tmp, { force: true });
    }
  } finally {
    await rm(tmp, { force: true });
  }
  if (missed === n) throw new RounderError('damaged', "No frames could be read from this video. It may be damaged.");
  ctx.progress({ stage: 'encoding' });
  const data = new Uint8Array(await (await encodeImage(sheet, o.format === 'png' ? { format: 'png' } : { format: 'jpeg', quality: 85 })).arrayBuffer());
  const ext = o.format === 'png' ? 'png' : 'jpg';
  const warnings = missed ? [`${missed} frame${missed === 1 ? '' : 's'} couldn't be read and ${missed === 1 ? 'is' : 'are'} left blank.`] : [];
  if (n < o.frames) warnings.push(`The clip is short, so it has ${n} frames instead of ${o.frames}.`);
  const meta = { frames: n, times: times.map((t) => Number(t.toFixed(2))), width: layout.width, height: layout.height, columns: layout.columns, duration };
  return result({ files: [new FileOutput({ name: withSuffix(src.name, '-contact-sheet', ext), mime: o.format === 'png' ? 'image/png' : 'image/jpeg', data, meta, warnings })] });
}

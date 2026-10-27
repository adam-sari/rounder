/*
 * Media engine smoke tests: real files through every API, in a real browser. Used by the
 * media lab's "Run smoke tests" button, and runnable from the console on any page of the
 * dev server (this module pulls in no Svelte/HMR code, so a reload elsewhere can't kill it):
 *
 *   const { runSmoke } = await import('/src/engines/media/lab/smoke.ts');
 *   console.table(await runSmoke());
 */
import {
  capabilities,
  computePeaks,
  concat,
  containers,
  decodeAudio,
  decodeGif,
  encodeAudio,
  extractFrames,
  formatBitrate,
  formatBytes,
  formatTime,
  frameAt,
  gifToVideo,
  imagesToVideo,
  probe,
  transcode,
  videoToGif,
  type Container,
} from '@/engines/media';

export interface SmokeResult {
  name: string;
  ok: boolean | null;
  ms: number;
  detail: string;
}

export interface SmokeHooks {
  /** keeps an interesting output for inspection */
  keep?: (label: string, blob: Blob, ext: string) => void;
  onStatus?: (status: string) => void;
  /** called with the whole table whenever a row changes */
  onUpdate?: (rows: SmokeResult[]) => void;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export async function fixture(name: string) {
  const blob = await (await fetch(`/tests/fixtures/media/${name}`)).blob();
  return new File([blob], name, { type: blob.type, lastModified: 1 });
}

export function drawOverlay(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, f: { time: number; width: number; height: number }) {
  const size = Math.max(14, Math.round(f.height / 14));
  ctx.font = `600 ${size}px "Geist Mono Variable", monospace`;
  ctx.fillStyle = '#131211aa';
  ctx.fillRect(f.width * 0.04, f.height - size * 2.2, size * 9.5, size * 1.6);
  ctx.fillStyle = '#ffd25e';
  ctx.fillText(`ROUNDER ${formatTime(f.time)}`, f.width * 0.04 + size * 0.4, f.height - size * 1.0);
}

export async function testImages(): Promise<Blob[]> {
  const colors = ['#ff6b4a', '#ffd25e', '#7cc4ff', '#9be58f'];
  return Promise.all(
    colors.map((c, i) => {
      const canvas = new OffscreenCanvas(i % 2 ? 900 : 600, i % 2 ? 600 : 900);
      const ctx = canvas.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      g.addColorStop(0, c);
      g.addColorStop(1, '#131211');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f2ede4';
      ctx.font = '700 160px sans-serif';
      ctx.fillText(String(i + 1), 60, 220);
      return canvas.convertToBlob({ type: 'image/png' });
    }),
  );
}

export async function runSmoke(hooks: SmokeHooks = {}): Promise<SmokeResult[]> {
  const keep = hooks.keep ?? (() => {});
  const mp4 = await fixture('sample.mp4');
  const webm = await fixture('sample.webm');
  const mov = await fixture('sample.mov');
  const mp3 = await fixture('sample.mp3');
  const wav = await fixture('sample.wav');
  const gif = await fixture('sample.gif');
  const avi = await fixture('sample.avi');

  const tests: [string, () => Promise<string>][] = [
      ['capabilities', async () => {
        const c = await capabilities();
        return `video enc [${c.video.encode}] · audio enc [${c.audio.encode}] · nativeAac ${c.audio.nativeAac}`;
      }],
      ...[mp4, webm, mov, mp3, wav, gif].map((f): [string, () => Promise<string>] => [`probe ${f.name}`, async () => {
        const i = await probe(f);
        assert(near(i.durationSec, f.name.endsWith('wav') || f.name.endsWith('gif') ? 2 : 3, 0.1), `duration ${i.durationSec}`);
        assert(!i.needsFallback, 'needs fallback');
        return `${i.container} ${i.video ? `${i.video.codec} ${i.video.displayWidth}×${i.video.displayHeight} ${i.video.fps}fps` : ''} ${i.audio ? `${i.audio.codec} ${i.audio.sampleRate}Hz ${i.audio.channels}ch` : ''}`;
      }]),
      ['probe avi (unreadable natively)', async () => {
        const i = await probe(avi);
        assert(!i.readable && i.needsFallback, 'avi should need the fallback');
        return 'readable:false needsFallback:true';
      }],
      ['mp4 → webm (vp9/opus)', async () => {
        const r = await transcode(mp4, { container: 'webm' });
        const i = await probe(r.blob);
        assert(i.container === 'webm' && i.video && i.audio, 'tracks');
        assert(near(i.durationSec, 3, 0.15), `duration ${i.durationSec}`);
        keep('mp4-webm', r.blob, 'webm');
        return `${i.video!.codec}/${i.audio!.codec} ${formatBytes(r.blob.size)}`;
      }],
      ['webm → mp4 (avc/aac)', async () => {
        const r = await transcode(webm, { container: 'mp4', video: { codec: 'avc' }, audio: { codec: 'aac' } });
        const i = await probe(r.blob);
        assert(i.video?.codec === 'avc' && i.audio?.codec === 'aac', `${i.video?.codec}/${i.audio?.codec}`);
        keep('webm-mp4', r.blob, 'mp4');
        return `${formatBytes(r.blob.size)} ${r.notes.join(' ')}`;
      }],
      ['mov → mp4 remux (no re-encode)', async () => {
        const t0 = performance.now();
        const r = await transcode(mov, { container: 'mp4' });
        const i = await probe(r.blob);
        assert(i.video?.codec === 'avc' && near(i.durationSec, 3, 0.1), 'remux');
        return `${Math.round(performance.now() - t0)} ms ${formatBytes(r.blob.size)}`;
      }],
      ['trim 0.5–2.0 + 9:16 cover 360×640 + overlay hook', async () => {
        const r = await transcode(mp4, { container: 'mp4', trim: { start: 0.5, end: 2 }, video: { width: 360, height: 640, fit: 'cover', overlay: drawOverlay } });
        const i = await probe(r.blob);
        assert(i.video?.displayWidth === 360 && i.video?.displayHeight === 640, `${i.video?.displayWidth}×${i.video?.displayHeight}`);
        assert(near(i.durationSec, 1.5, 0.12), `duration ${i.durationSec}`);
        keep('reels-overlay', r.blob, 'mp4');
        return `${formatTime(i.durationSec)} ${formatBytes(r.blob.size)}`;
      }],
      ['rotate 90 + flip, then crop (crop is in the rotated frame)', async () => {
        // 640×360 turned 90° is 360×640; keep a 360×204 band from its middle
        const r = await transcode(mp4, { container: 'mp4', video: { rotate: 90, flipVertical: true, crop: { x: 0, y: 218, width: 360, height: 204 } } });
        const i = await probe(r.blob);
        assert(i.video?.displayWidth === 360 && i.video?.displayHeight === 204, `${i.video?.displayWidth}×${i.video?.displayHeight}`);
        keep('crop-rotate', r.blob, 'mp4');
        return `${i.video!.displayWidth}×${i.video!.displayHeight}`;
      }],
      ['speed 2× (fps cap 30)', async () => {
        const r = await transcode(mp4, { container: 'mp4', video: { speed: 2, fps: 30 } });
        const i = await probe(r.blob);
        assert(near(i.durationSec, 1.5, 0.15), `duration ${i.durationSec}`);
        keep('speed2x', r.blob, 'mp4');
        return `${formatTime(i.durationSec)} fps ${i.video?.fps}`;
      }],
      ['speed 0.5×', async () => {
        const r = await transcode(mp4, { container: 'mp4', video: { speed: 0.5 } });
        const i = await probe(r.blob);
        assert(near(i.durationSec, 6, 0.2), `duration ${i.durationSec}`);
        return formatTime(i.durationSec);
      }],
      ['target size 150 KB', async () => {
        const r = await transcode(mp4, { container: 'mp4', video: { targetSizeBytes: 150_000 } });
        assert(r.blob.size < 150_000 * 1.25, `size ${r.blob.size}`);
        return `${formatBytes(r.blob.size)} (${formatBitrate((r.blob.size * 8) / 3)})`;
      }],
      ['mute', async () => {
        const r = await transcode(mp4, { container: 'mp4', audio: false });
        const i = await probe(r.blob);
        assert(i.video && !i.audio, 'audio still present');
        return 'video only';
      }],
      ['replace audio with mp3', async () => {
        const r = await transcode(mp4, { container: 'mp4', audio: { replace: mp3 } });
        const i = await probe(r.blob);
        assert(i.video && i.audio && near(i.durationSec, 3, 0.15), `tracks / duration ${i.durationSec}`);
        keep('replace-audio', r.blob, 'mp4');
        return `${i.audio!.codec} ${formatTime(i.durationSec)}`;
      }],
      ['video → mp3 192k (LAME)', async () => {
        const r = await transcode(mp4, { container: 'mp3', audio: { bitrate: 192_000 } });
        const i = await probe(r.blob);
        assert(i.container === 'mp3' && near(i.durationSec, 3, 0.15), `${i.container} ${i.durationSec}`);
        keep('to-mp3', r.blob, 'mp3');
        return formatBytes(r.blob.size);
      }],
      ['mp3 → m4a (aac) +6 dB', async () => {
        const r = await transcode(mp3, { container: 'm4a', audio: { gainDb: 6 } });
        const i = await probe(r.blob);
        assert(i.audio?.codec === 'aac', `${i.audio?.codec}`);
        return formatBytes(r.blob.size);
      }],
      ['wav → ogg (opus) + wav → flac', async () => {
        const ogg = await transcode(wav, { container: 'ogg' });
        const io = await probe(ogg.blob);
        assert(io.audio?.codec === 'opus', `${io.audio?.codec}`);
        const fl = await transcode(wav, { container: 'flac' });
        const fi = await probe(fl.blob);
        assert(fi.audio?.codec === 'flac' && near(fi.durationSec, 2, 0.05), `flac ${fi.audio?.codec} ${fi.durationSec}`);
        const flac = `flac ${formatBytes(fl.blob.size)} via ${fl.via}`;
        return `ogg ${formatBytes(ogg.blob.size)} · ${flac}`;
      }],
      ['every container from mp4', async () => {
        const res: string[] = [];
        for (const c of Object.keys(containers) as Container[]) {
          const r = await transcode(mp4, { container: c, video: { quality: 'low' } }).then((x) => formatBytes(x.blob.size), (e) => `✗ ${e.code}`);
          res.push(`${c}:${r}`);
        }
        assert(!res.some((r) => r.includes('✗')), res.join(' '));
        return res.join(' · ');
      }],
      ['extractFrames ×6 + frameAt', async () => {
        const got: number[] = [];
        const f = await extractFrames(mp4, { count: 6, height: 90 }, { onFrame: (x) => got.push(x.time) });
        assert(f.length === 6 && got.length === 6, `frames ${f.length}`);
        assert(f[0].bitmap.height === 90 && f[0].bitmap.width === 160, `${f[0].bitmap.width}×${f[0].bitmap.height}`);
        const still = await frameAt(mp4, 1.5);
        assert(still.width === 640 && still.height === 360, 'frameAt size');
        return got.map((t) => t.toFixed(2)).join(', ');
      }],
      ['decodeAudio + peaks', async () => {
        const p = await decodeAudio(mp4);
        assert(p.sampleRate === 48000 && near(p.channels[0].length / p.sampleRate, 3, 0.05), `${p.sampleRate} ${p.channels[0].length}`);
        const pk = computePeaks(p, 100);
        assert(Math.max(...pk.max) > 0.05, 'silent?');
        const w = await decodeAudio(wav, { mono: true, sampleRate: 22050, start: 0.5, end: 1.5 });
        assert(w.channels.length === 1 && near(w.channels[0].length, 22050, 2), `mono ${w.channels[0].length}`);
        return `48k ${p.channels.length}ch peak ${Math.max(...pk.max).toFixed(2)} · wav slice ${w.channels[0].length}`;
      }],
      ['encodeAudio mp3 / wav / m4a / ogg / flac (+ odd bitrate)', async () => {
        const p = await decodeAudio(wav);
        const out: string[] = [];
        for (const format of ['mp3', 'wav', 'm4a', 'ogg', 'flac'] as const) {
          // 100 kb/s is not a rate native AAC accepts; the engine must round it
          const b = await encodeAudio(p, { format, bitrate: 100_000 });
          const i = await probe(b);
          assert(near(i.durationSec, 2, 0.1), `${format} duration ${i.durationSec}`);
          out.push(`${format} ${formatBytes(b.size)}`);
        }
        return out.join(' · ');
      }],
      ['concat mp4 + webm + mov → mp4', async () => {
        const r = await concat([mp4, webm, mov], { container: 'mp4' });
        const i = await probe(r.blob);
        assert(near(i.durationSec, 9, 0.3) && i.video?.displayWidth === 640 && i.audio, `${i.durationSec} ${i.video?.displayWidth}`);
        keep('concat', r.blob, 'mp4');
        return `${formatTime(i.durationSec)} ${formatBytes(r.blob.size)}`;
      }],
      ['concat mp3 + wav → mp3', async () => {
        const r = await concat([mp3, wav], { container: 'mp3' });
        const i = await probe(r.blob);
        assert(near(i.durationSec, 5, 0.2), `${i.durationSec}`);
        return formatTime(i.durationSec);
      }],
      ['slideshow 4 images + soundtrack', async () => {
        const r = await imagesToVideo(await testImages(), { width: 540, height: 960, durations: 1, transition: 'fade', kenBurns: true, audio: mp3 });
        const i = await probe(r.blob);
        assert(near(i.durationSec, 4, 0.15) && i.audio && i.video?.displayHeight === 960, `${i.durationSec}`);
        keep('slideshow', r.blob, 'mp4');
        return formatBytes(r.blob.size);
      }],
      ['video → gif → mp4', async () => {
        const g = await videoToGif(mp4, { fps: 10, width: 240, end: 2 });
        const i = await probe(g);
        assert(i.container === 'gif' && i.video?.width === 240 && near(i.durationSec, 2, 0.15), `${i.video?.width} ${i.durationSec}`);
        const v = await gifToVideo(gif, { repeat: 2 });
        const iv = await probe(v.blob);
        assert(near(iv.durationSec, 4, 0.15), `gif→mp4 ${iv.durationSec}`);
        const d = await decodeGif(gif);
        assert(d.frames.length === 20, `frames ${d.frames.length}`);
        keep('to-gif', g, 'gif');
        return `gif ${formatBytes(g.size)} · mp4 ${formatTime(iv.durationSec)}`;
      }],
      ['AVI via ffmpeg.wasm fallback (normalize)', async () => {
        const r = await transcode(avi, { container: 'mp4', trim: { start: 0.5, end: 1.5 } }, { onStatus: hooks.onStatus });
        const i = await probe(r.blob);
        assert(i.video?.codec === 'avc' && near(i.durationSec, 1, 0.15), `${i.video?.codec} ${i.durationSec}`);
        keep('avi', r.blob, 'mp4');
        return `${r.notes.join(' ')} ${formatBytes(r.blob.size)}`;
      }],
      ['ffmpeg direct engine', async () => {
        const r = await transcode(mp4, { container: 'webm', trim: { end: 1 }, video: { width: 320 } }, { engine: 'ffmpeg' });
        const i = await probe(r.blob);
        assert(i.video?.displayWidth === 320 && near(i.durationSec, 1, 0.15), `${i.video?.displayWidth} ${i.durationSec}`);
        return formatBytes(r.blob.size);
      }],
      ['decodeAudio of AVI (ffmpeg)', async () => {
        const p = await decodeAudio(avi);
        assert(near(p.channels[0].length / p.sampleRate, 2, 0.15), `${p.channels[0].length / p.sampleRate}`);
        return `${p.sampleRate} Hz`;
      }],
      ['abort an ffmpeg job, then the next one still works', async () => {
      const c = new AbortController();
      const job = transcode(mp4, { container: 'mp4', video: { width: 640 } }, { engine: 'ffmpeg', signal: c.signal, onProgress: () => c.abort() });
      const err = await job.then(() => null, (e) => e);
      assert(err?.code === 'aborted', `got ${err?.code ?? 'success'}`);
      const r = await transcode(mp4, { container: 'mp3', trim: { end: 1 } }, { engine: 'ffmpeg' });
      assert(r.via === 'ffmpeg' && r.blob.size > 1000, 'second job');
      return `aborted, then ${formatBytes(r.blob.size)}`;
    }],
    ['abort mid-transcode', async () => {
        const c = new AbortController();
        setTimeout(() => c.abort(), 30);
        const err = await transcode(mp4, { container: 'webm', video: { width: 640 } }, { signal: c.signal }).then(() => null, (e) => e);
        assert(err?.code === 'aborted', `got ${err?.code ?? 'success'}`);
        return 'MediaError aborted';
      }],
    ];

  const rows: SmokeResult[] = tests.map(([name]) => ({ name, ok: null, ms: 0, detail: '' }));
  hooks.onUpdate?.([...rows]);
  for (const [i, [name, run]] of tests.entries()) {
    const t0 = performance.now();
    try {
      rows[i] = { name, ok: true, detail: await run(), ms: performance.now() - t0 };
    } catch (e) {
      rows[i] = { name, ok: false, detail: `${(e as { code?: string }).code ?? ''} ${(e as Error).message}`, ms: performance.now() - t0 };
      console.error(name, e);
    }
    hooks.onUpdate?.([...rows]);
  }
  return rows;
}

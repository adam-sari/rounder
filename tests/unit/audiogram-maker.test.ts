import { describe, expect, it } from 'vitest';
import { analyze, ANALYSIS_RATE, BANDS, bandEdges, fft, frameBands, frameLevel, normalise } from '@/tools/lib/audiogram-maker/spectrum';
import { ASPECTS, carrierSize, clampSection, inkFor, MAX_SECTION, outputSize, STYLES, titleFromName, withAlpha, clock, estimateBytes } from '@/tools/lib/audiogram-maker/design';
import { layout, type Ctx, type Design, type Img } from '@/tools/lib/audiogram-maker/render';
import def from '@/tools/defs/audiogram-maker';

const sine = (hz: number, sec: number, rate = ANALYSIS_RATE, amp = 0.5) => Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

describe('fft', () => {
  it('matches a direct DFT', () => {
    const n = 64;
    const x = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1));
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (const k of [0, 1, 5, 17, 31]) {
      let r = 0;
      let m = 0;
      for (let t = 0; t < n; t++) {
        r += x[t] * Math.cos((-2 * Math.PI * k * t) / n);
        m += x[t] * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(m, 9);
    }
  });
});

describe('spectrum analysis', () => {
  it('gives one frame per video frame', async () => {
    const s = await analyze(sine(440, 2), ANALYSIS_RATE, 30);
    expect(s.frames).toBe(60);
    expect(s.bands.length).toBe(60 * BANDS);
    expect(s.level.length).toBe(60);
  });

  it('lights up the band holding the tone', async () => {
    const edges = bandEdges(ANALYSIS_RATE);
    for (const hz of [110, 1000, 5000]) {
      const s = await analyze(sine(hz, 1), ANALYSIS_RATE, 30);
      const f = 15 * BANDS;
      const row = Array.from(s.bands.subarray(f, f + BANDS));
      const top = row.indexOf(Math.max(...row));
      expect(edges[top] <= hz * 1.15 && edges[top + 1] >= hz / 1.15).toBe(true);
    }
  });

  it('stays flat on silence', async () => {
    const s = await analyze(new Float32Array(ANALYSIS_RATE), ANALYSIS_RATE, 30);
    expect(Math.max(...s.bands)).toBe(0);
    expect(Math.max(...s.level)).toBe(0);
  });

  it('follows loudness and stays within 0–1', async () => {
    const quiet = sine(300, 1, ANALYSIS_RATE, 0.02);
    const loud = sine(300, 1, ANALYSIS_RATE, 0.8);
    const both = new Float32Array(quiet.length + loud.length);
    both.set(quiet);
    both.set(loud, quiet.length);
    const s = await analyze(both, ANALYSIS_RATE, 30);
    expect(frameLevel(s, 1.5)).toBeGreaterThan(frameLevel(s, 0.5) + 0.3);
    for (const v of s.bands) expect(v >= 0 && v <= 1).toBe(true);
  });

  it('can be cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(analyze(sine(200, 30), ANALYSIS_RATE, 30, { signal: ctrl.signal })).rejects.toThrow();
  });

  it('rises fast and falls slowly', () => {
    const raw = Float32Array.from([-100, -100, -10, -10, -100, -100, -100], (v) => v);
    const out = normalise(raw, 1, 45);
    expect(out[2]).toBeGreaterThan(0.6);
    expect(out[4]).toBeGreaterThan(0.3);
    expect(out[6]).toBeLessThan(out[4]);
  });

  it('resamples a frame to any bar count and zeros outside the clip', () => {
    const bands = new Float32Array(2 * BANDS);
    for (let b = 0; b < BANDS; b++) bands[BANDS + b] = b / (BANDS - 1);
    const s = { fps: 30, frames: 2, bands, level: new Float32Array(2) };
    const v = frameBands(s, 1 / 30, 3);
    expect(Array.from(v)).toEqual([0, 0.5, 1].map((x) => expect.closeTo(x, 5)));
    expect(Array.from(frameBands(s, 5, 3))).toEqual([0, 0, 0]);
    expect(Array.from(frameBands(s, -1, 3))).toEqual([0, 0, 0]);
    expect(Array.from(frameBands(null, 0, 2))).toEqual([0, 0]);
  });

  it('spaces bands logarithmically below Nyquist', () => {
    const e = bandEdges(ANALYSIS_RATE);
    expect(e.length).toBe(BANDS + 1);
    expect(e[0]).toBe(40);
    expect(e[BANDS]).toBeLessThan(ANALYSIS_RATE / 2);
    expect(e[2] / e[1]).toBeCloseTo(e[40] / e[39], 6);
  });
});

describe('design helpers', () => {
  it('sizes each shape with the short side at the chosen resolution', () => {
    expect(outputSize('1:1', 1080)).toEqual({ width: 1080, height: 1080 });
    expect(outputSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('16:9', 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize('4:5', 1080)).toEqual({ width: 1080, height: 1350 });
  });

  it('makes a small even carrier of the same shape', () => {
    for (const a of ASPECTS) {
      const c = carrierSize(a.id);
      expect(c.width % 2 + (c.height % 2)).toBe(0);
      expect(Math.max(c.width, c.height)).toBeLessThanOrEqual(240);
      expect(c.width / c.height).toBeCloseTo(a.w / a.h, 1);
    }
  });

  it('keeps the section between 1 s and 10 min', () => {
    expect(clampSection(0, 900, 3600, 'end')).toEqual({ start: 900 - MAX_SECTION, end: 900 });
    expect(clampSection(100, 900, 3600, 'start')).toEqual({ start: 100, end: 100 + MAX_SECTION });
    expect(clampSection(10, 10.2, 60, 'end')).toEqual({ start: 10, end: 11 });
    expect(clampSection(59.8, 60, 60, 'start')).toEqual({ start: 59, end: 60 });
    expect(clampSection(0, 0.5, 0.5, 'end')).toEqual({ start: 0, end: 0.5 });
  });

  it('picks readable ink', () => {
    expect(inkFor('#191613', '#2c2216')).toBe('#ffffff');
    expect(inkFor('#f4efe6')).toBe('#141210');
    expect(inkFor('nonsense')).toBe('#ffffff');
    expect(withAlpha('#ffd25e', 0.5)).toBe('rgba(255, 210, 94, 0.5)');
  });

  it('formats names, clocks and estimates', () => {
    expect(titleFromName('Episode_12 - Guest.final.mp3')).toBe('Episode 12 - Guest.final');
    expect(clock(65.9)).toBe('1:05');
    expect(estimateBytes(60, 1080, 1080)).toBeGreaterThan(estimateBytes(60, 720, 720));
  });
});

/** enough of a 2D context for layout: text is half its size wide per character */
function fakeCtx(): Ctx {
  const ctx = {
    font: '',
    measureText(s: string) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: s.length * px * 0.5 };
    },
  };
  return ctx as unknown as Ctx;
}

const img = { width: 800, height: 800 } as Img;
const base: Design = {
  style: 'bars', backdrop: 'gradient', bg1: '#191613', bg2: '#2c2216', image: null, blur: 0.5, darken: 0.4, accent: '#ffd25e',
  title: 'A rather long episode title that needs to wrap over a couple of lines at least', subtitle: 'The Show · with a guest',
  cover: img, progress: true, captions: true,
};

describe('layout', () => {
  const inside = (b: { x: number; y: number; w: number; h: number }, W: number, H: number) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= W + 0.5 && b.y + b.h <= H + 0.5;

  it('keeps every part on the frame for all shapes and styles', () => {
    for (const a of ASPECTS) {
      const { width: W, height: H } = outputSize(a.id, 1080);
      for (const s of STYLES) {
        for (const cover of [img, null]) {
          const scene = layout(fakeCtx(), W, H, { ...base, style: s.id, cover });
          const parts = [scene.visual, scene.cover, scene.title?.box, scene.subtitle?.box, scene.progress, scene.caption].filter((b) => !!b);
          for (const p of parts) expect(inside(p, W, H), `${a.id} ${s.id} ${JSON.stringify(p)}`).toBe(true);
          expect(scene.visual.w).toBeGreaterThan(0);
          expect(scene.visual.h).toBeGreaterThan(0);
          if (s.id === 'circle') expect(scene.visual.w).toBeCloseTo(scene.visual.h);
          // stacked parts never overlap
          const sorted = [...parts].sort((p, q) => p.y - q.y);
          if (scene.align === 'center') for (let i = 1; i < sorted.length; i++) expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h - 0.5);
        }
      }
    }
  });

  it('puts cover art beside the text on wide videos', () => {
    const scene = layout(fakeCtx(), 1920, 1080, base);
    expect(scene.align).toBe('left');
    expect(scene.cover!.x + scene.cover!.w).toBeLessThan(scene.title!.box.x);
  });

  it('limits the title to two lines with an ellipsis', () => {
    const scene = layout(fakeCtx(), 1080, 1080, { ...base, title: 'word '.repeat(80) });
    expect(scene.title!.lines.length).toBe(2);
    expect(scene.title!.lines[1].endsWith('…')).toBe(true);
  });

  it('leaves out what is empty', () => {
    const scene = layout(fakeCtx(), 1080, 1080, { ...base, title: ' ', subtitle: '', cover: null, progress: false, captions: false });
    expect(scene.title).toBeNull();
    expect(scene.subtitle).toBeNull();
    expect(scene.progress).toBeNull();
    expect(scene.caption).toBeNull();
    expect(scene.cover).toBeNull();
  });
});

describe('page', () => {
  it('fits the search snippet limits', () => {
    expect(def.title.length).toBeLessThanOrEqual(65);
    expect(def.description.length).toBeLessThanOrEqual(160);
    expect(def.keywords.length).toBeGreaterThanOrEqual(6);
    expect(def.keywords.length).toBeLessThanOrEqual(10);
    expect(def.steps).toHaveLength(3);
    expect(def.faq.at(-1)?.q).toMatch(/uploaded/);
  });
});

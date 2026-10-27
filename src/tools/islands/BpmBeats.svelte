<script lang="ts">
  /* Whole-song waveform to scrub, and a close-up around the playhead with every detected beat. */
  import { formatTime, type Peaks } from '@/engines/media';

  interface Props {
    peaks: Peaks;
    beats: Float64Array;
    duration: number;
    /** playhead, seconds */
    time: number;
    onseek: (t: number) => void;
  }

  let { peaks, beats, duration, time, onseek }: Props = $props();

  /** seconds shown in the close-up */
  const SPAN = 6;

  let overview: HTMLCanvasElement;
  let zoom: HTMLCanvasElement;
  let width = $state(0);
  let colors: { wave: string; played: string; beat: string; head: string } | null = null;

  function resolve(el: HTMLElement, v: string) {
    el.style.color = v;
    return getComputedStyle(el).color;
  }

  /** index of the first beat at or after t */
  function firstBeat(t: number) {
    let lo = 0;
    let hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function setup(canvas: HTMLCanvasElement, cssHeight: number) {
    const dpr = devicePixelRatio || 1;
    const W = Math.round(width * dpr);
    const H = Math.round(cssHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H, dpr };
  }

  /** waveform of [t0, t1] across the canvas; columns before `split` px use the played colour */
  function drawWave(ctx: CanvasRenderingContext2D, W: number, H: number, t0: number, t1: number, split: number) {
    const n = peaks.max.length;
    const perSec = n / Math.max(duration, 1e-6);
    const mid = H / 2;
    for (let x = 0; x < W; x++) {
      const a = Math.floor((t0 + ((t1 - t0) * x) / W) * perSec);
      const b = Math.max(a + 1, Math.floor((t0 + ((t1 - t0) * (x + 1)) / W) * perSec));
      if (b <= 0 || a >= n) continue;
      let hi = 0;
      let rms = 0;
      for (let i = Math.max(0, a); i < b && i < n; i++) {
        hi = Math.max(hi, peaks.max[i], -peaks.min[i]);
        rms = Math.max(rms, peaks.rms[i]);
      }
      ctx.fillStyle = x < split ? colors!.played : colors!.wave;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, mid - hi * mid, 1, Math.max(1, hi * H));
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, mid - rms * mid, 1, Math.max(1, rms * H));
    }
    ctx.globalAlpha = 1;
  }

  $effect(() => {
    if (!overview || !zoom || !width) return;
    colors ??= {
      wave: resolve(overview, 'var(--color-soft)'),
      played: resolve(overview, 'var(--color-sun)'),
      beat: resolve(overview, 'var(--color-sun)'),
      head: resolve(overview, 'var(--color-chalk)'),
    };
    const t = time;

    {
      const { ctx, W, H, dpr } = setup(overview, 56);
      const head = (t / Math.max(duration, 1e-6)) * W;
      drawWave(ctx, W, H, 0, duration, head);
      // the close-up's window, so it's clear what the lower view shows
      const from = Math.max(0, Math.min(t - SPAN / 2, duration - SPAN));
      ctx.fillStyle = colors.head;
      ctx.globalAlpha = 0.08;
      ctx.fillRect((from / duration) * W, 0, (SPAN / duration) * W, H);
      ctx.globalAlpha = 1;
      ctx.fillRect(Math.round(head), 0, Math.max(1, dpr), H);
    }

    {
      const { ctx, W, H, dpr } = setup(zoom, 112);
      const from = Math.max(0, Math.min(t - SPAN / 2, duration - SPAN));
      const to = from + SPAN;
      const px = (s: number) => ((s - from) / SPAN) * W;
      drawWave(ctx, W, H, from, to, px(t));
      for (let i = firstBeat(from); i < beats.length && beats[i] <= to; i++) {
        // beats light up as the playhead passes and fade over the next half second
        const since = t - beats[i];
        const lit = since >= 0 && since < 0.5 ? 1 - since / 0.5 : 0;
        ctx.fillStyle = colors.beat;
        ctx.globalAlpha = 0.45 + 0.55 * lit;
        const w = Math.max(1, Math.round(dpr * (1.5 + lit)));
        ctx.fillRect(Math.round(px(beats[i]) - w / 2), 0, w, H);
        ctx.beginPath();
        ctx.arc(px(beats[i]), 7 * dpr, (3 + 2 * lit) * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.head;
      ctx.fillRect(Math.round(px(t)), 0, Math.max(1, dpr), H);
    }
  });

  let dragging = false;
  function seekTo(e: PointerEvent) {
    const r = overview.getBoundingClientRect();
    onseek(Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration)));
  }

  function onkey(e: KeyboardEvent) {
    const step = e.shiftKey ? 15 : 5;
    const next = e.key === 'ArrowRight' ? time + step : e.key === 'ArrowLeft' ? time - step : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null;
    if (next === null) return;
    e.preventDefault();
    onseek(Math.max(0, Math.min(duration, next)));
  }
</script>

<div class="beats" bind:clientWidth={width}>
  <canvas
    bind:this={overview}
    class="overview"
    role="slider"
    tabindex="0"
    aria-label="Position in the song"
    aria-valuemin={0}
    aria-valuemax={Math.round(duration)}
    aria-valuenow={Math.round(time)}
    aria-valuetext={formatTime(time, 0)}
    onpointerdown={(e) => {
      dragging = true;
      overview.setPointerCapture(e.pointerId);
      seekTo(e);
    }}
    onpointermove={(e) => dragging && seekTo(e)}
    onpointerup={() => (dragging = false)}
    onpointercancel={() => (dragging = false)}
    onkeydown={onkey}
  ></canvas>
  <canvas bind:this={zoom} class="zoom" aria-hidden="true"></canvas>
  <p class="mono flex justify-between gap-3">
    <span>{beats.length} beats marked · close-up shows {SPAN} s around the playhead</span>
    <span class="tabular">{formatTime(time, 1)} / {formatTime(duration, 0)}</span>
  </p>
</div>

<style>
  .beats {
    display: grid;
    gap: 8px;
  }
  canvas {
    display: block;
    width: 100%;
    border-radius: 12px;
    background: #141312;
    border: 1px solid var(--color-line);
  }
  .overview {
    height: 56px;
    cursor: pointer;
    touch-action: none;
  }
  .zoom {
    height: 112px;
    background:
      repeating-linear-gradient(90deg, transparent 0 39px, #f2ede40a 39px 40px),
      #141312;
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }
</style>

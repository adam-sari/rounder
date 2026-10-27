<script lang="ts">
  import type { Peaks } from '@/engines/media';

  interface Props {
    peaks: Peaks | null;
    /** any CSS color, including var(--…) */
    color?: string;
    /** 0–1: the part before this is drawn in `playedColor` */
    progress?: number;
    playedColor?: string;
    /** vertical zoom, for quiet recordings */
    gain?: number;
  }

  let { peaks, color = 'var(--color-audio)', progress = 0, playedColor = 'var(--color-chalk)', gain = 1 }: Props = $props();

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let height = $state(0);

  /** canvas can't read CSS variables, so let the browser resolve them */
  function resolve(c: string) {
    canvas.style.color = c;
    return getComputedStyle(canvas).color;
  }

  $effect(() => {
    const dpr = devicePixelRatio || 1;
    const W = Math.round(width * dpr);
    const H = Math.round(height * dpr);
    if (!canvas || !W || !H) return;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    if (!peaks) return;
    const base = resolve(color);
    const played = resolve(playedColor);
    const n = peaks.max.length;
    const mid = H / 2;
    const bar = Math.max(1, Math.round(dpr));
    const split = progress * W;
    for (let x = 0; x < W; x += bar) {
      // each column covers a range of buckets; take the extremes so short transients survive
      const a = Math.floor((x / W) * n);
      const b = Math.max(a + 1, Math.floor(((x + bar) / W) * n));
      let lo = 0;
      let hi = 0;
      let rms = 0;
      for (let i = a; i < b && i < n; i++) {
        lo = Math.min(lo, peaks.min[i]);
        hi = Math.max(hi, peaks.max[i]);
        rms = Math.max(rms, peaks.rms[i]);
      }
      const fill = x < split ? played : base;
      const top = mid - Math.min(1, hi * gain) * mid;
      const bottom = mid - Math.max(-1, lo * gain) * mid;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = fill;
      ctx.fillRect(x, top, bar, Math.max(1, bottom - top));
      const r = Math.min(1, rms * gain) * mid;
      ctx.globalAlpha = 1;
      ctx.fillRect(x, mid - r, bar, Math.max(1, r * 2));
    }
  });
</script>

<div class="wave" bind:clientWidth={width} bind:clientHeight={height}>
  <canvas bind:this={canvas} aria-hidden="true"></canvas>
</div>

<style>
  .wave {
    position: relative;
    width: 100%;
    height: 100%;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
</style>

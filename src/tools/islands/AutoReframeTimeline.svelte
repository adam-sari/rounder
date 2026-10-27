<script lang="ts">
  import { formatTime } from '@/engines/media/math';
  import { centerAt, manualAt, type Keyframe, type Kind, type Path } from '@/tools/lib/reframe/path';

  /*
   * The crop path over time: the line is where the window sits across the frame (top = left
   * edge, bottom = right edge, or top/bottom for tall sources), with scene cuts, what the AI
   * followed (face, motion, centre), the stretches the visitor pinned, and their keyframes.
   * Click or drag to scrub; keyframes are buttons that jump to their moment.
   */
  interface Props {
    path: Path;
    keys: Keyframe[];
    duration: number;
    time: number;
    playing: boolean;
    selected: number | null;
  }

  let { path, keys, duration, time = $bindable(0), playing = $bindable(false), selected = $bindable(null) }: Props = $props();

  const N = 240;
  const TOP = 6;
  const BOTTOM = 82;
  let el = $state<HTMLDivElement>();
  let scrubbing: number | null = null;

  // the axis the window can move along
  const axis = $derived(path.cw < 0.999 ? 'x' : 'y');
  const lo = $derived((axis === 'x' ? path.cw : path.ch) / 2);
  const span = $derived(Math.max(1e-6, 1 - 2 * lo));
  const yOf = (v: number) => TOP + ((v - lo) / span) * (BOTTOM - TOP);
  const xOf = (t: number) => (t / (duration || 1)) * 1000;

  const line = $derived.by(() => {
    const pts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * duration;
      pts.push(`${xOf(t).toFixed(1)},${yOf(centerAt(path, keys, t)[axis]).toFixed(1)}`);
    }
    return pts.join(' ');
  });

  /** runs of the same value, as [start, end] times */
  function runs<T>(points: { t: number; v: T }[], end: number) {
    const out: { from: number; to: number; v: T }[] = [];
    points.forEach((p, i) => {
      const to = points[i + 1]?.t ?? end;
      const last = out.at(-1);
      if (last && last.v === p.v) last.to = to;
      else out.push({ from: p.t, to, v: p.v });
    });
    return out;
  }

  const kinds = $derived(runs<Kind>(path.track.map((p) => ({ t: p.t, v: p.kind })), duration));
  const pinned = $derived(
    keys.length
      ? runs(
          Array.from({ length: N + 1 }, (_, i) => {
            const t = (i / N) * duration;
            return { t, v: manualAt(path, keys, t).weight > 0.5 };
          }),
          duration,
        ).filter((r) => r.v)
      : [],
  );
  const cuts = $derived(path.shots.slice(1).map((s) => s.start));

  function seek(e: PointerEvent) {
    const b = el!.getBoundingClientRect();
    time = Math.min(duration, Math.max(0, ((e.clientX - b.left) / b.width) * duration));
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    playing = false;
    scrubbing = e.pointerId;
    el!.setPointerCapture(e.pointerId);
    seek(e);
  }

  const kindLabel: Record<Kind, string> = { face: 'face', motion: 'motion', center: 'center' };
</script>

<div class="wrap">
  <div
    class="track"
    bind:this={el}
    role="presentation"
    onpointerdown={down}
    onpointermove={(e) => scrubbing === e.pointerId && seek(e)}
    onpointerup={() => (scrubbing = null)}
    onpointercancel={() => (scrubbing = null)}
  >
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
      {#each pinned as r}<rect class="pin" x={xOf(r.from)} y="0" width={Math.max(1, xOf(r.to) - xOf(r.from))} height={BOTTOM + 4} />{/each}
      {#each kinds as r}<rect class={`kind ${r.v}`} x={xOf(r.from)} y="90" width={Math.max(1, xOf(r.to) - xOf(r.from))} height="10" />{/each}
      {#each cuts as c}<line class="cut" x1={xOf(c)} x2={xOf(c)} y1="0" y2="88" />{/each}
      <polyline class="path" points={line} />
      <line class="head" x1={xOf(time)} x2={xOf(time)} y1="0" y2="100" />
    </svg>
    <span class="edge top" aria-hidden="true">{axis === 'x' ? 'left' : 'top'}</span>
    <span class="edge bottom" aria-hidden="true">{axis === 'x' ? 'right' : 'bottom'}</span>
    {#each keys as k (k.t)}
      <button
        type="button"
        class="key"
        class:track={k.track}
        class:on={selected === k.t}
        style:left={`${(k.t / (duration || 1)) * 100}%`}
        style:top={`${k.track ? 50 : yOf(centerAt(path, keys, k.t)[axis])}%`}
        aria-label={`${k.track ? 'Back to tracking' : 'Pinned frame'} at ${formatTime(k.t, 1)}`}
        aria-pressed={selected === k.t}
        onclick={() => {
          playing = false;
          selected = k.t;
          time = k.t;
        }}
      ></button>
    {/each}
  </div>
  <p class="legend mono" aria-hidden="true">
    {#each ['face', 'motion', 'center'] as const as k}<span><i class={`kind ${k}`}></i>{kindLabel[k]}</span>{/each}
    <span><i class="pin"></i>pinned by you</span>
    {#if cuts.length}<span><i class="cutmark"></i>{cuts.length} scene cut{cuts.length === 1 ? '' : 's'}</span>{/if}
  </p>
</div>

<style>
  .wrap {
    display: grid;
    gap: 6px;
  }
  .track {
    position: relative;
    height: 92px;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    background: #141312;
    overflow: hidden;
    cursor: ew-resize;
    touch-action: none;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .path {
    fill: none;
    stroke: var(--color-ai);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }
  .head {
    stroke: var(--color-chalk);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .cut {
    stroke: var(--color-muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }
  rect.pin,
  i.pin {
    fill: #ffd25e1f;
    background: #ffd25e33;
  }
  .kind.face {
    fill: var(--color-ai);
    background: var(--color-ai);
  }
  .kind.motion {
    fill: #c8a6ff66;
    background: #c8a6ff66;
  }
  .kind.center {
    fill: var(--color-line-2);
    background: var(--color-line-2);
  }
  .edge {
    position: absolute;
    left: 8px;
    font: 400 10px var(--font-mono);
    color: var(--color-muted);
    pointer-events: none;
    &.top {
      top: 2px;
    }
    &.bottom {
      bottom: 12px;
    }
  }
  .key {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    padding: 0;
    rotate: 45deg;
    background: var(--color-sun);
    border: 2px solid var(--color-bg);
    border-radius: 2px;
    cursor: pointer;
    &.track {
      rotate: none;
      border-radius: 50%;
      background: var(--color-bg);
      border-color: var(--color-ai);
    }
    &.on {
      outline: 2px solid var(--color-chalk);
      outline-offset: 1px;
    }
    /* a bigger invisible target for fingers */
    &::after {
      content: '';
      position: absolute;
      inset: -10px;
    }
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 11px;
    & span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    & i {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 3px;
    }
    & .cutmark {
      width: 0;
      height: 12px;
      border-left: 1px dashed var(--color-muted);
      border-radius: 0;
    }
  }
</style>

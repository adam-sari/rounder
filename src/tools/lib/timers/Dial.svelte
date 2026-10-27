<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    fraction,
    time,
    tail = '',
    caption = '',
    tone = 'var(--color-sun)',
    ringing = false,
    children,
  }: {
    /** how much of the ring is lit, 0–1 */
    fraction: number;
    time: string;
    /** smaller text after the time, e.g. centiseconds */
    tail?: string;
    caption?: string;
    tone?: string;
    ringing?: boolean;
    children?: Snippet;
  } = $props();

  // Instrument Serif has proportional digits, so each one gets a fixed-width slot to stop the time jiggling
  const chars = $derived([...time]);
  const ems = $derived(chars.reduce((w, c) => w + (/\d/.test(c) ? 0.56 : 0.3), 0) + (tail ? tail.length * 0.3 : 0));
  const size = $derived(`${Math.min(26, 64 / ems).toFixed(2)}cqi`);

  const f = $derived(Math.min(1, Math.max(0, fraction)));
  const head = $derived({ x: 60 + 52 * Math.sin(f * 2 * Math.PI), y: 60 - 52 * Math.cos(f * 2 * Math.PI) });
  const ticks = Array.from({ length: 60 }, (_, i) => i);
</script>

<div class="dial" class:ringing style:--tone={tone}>
  <svg viewBox="0 0 120 120" aria-hidden="true">
    {#each ticks as i}
      <line x1="60" y1={i % 5 ? 2.5 : 1.2} x2="60" y2="5" transform="rotate({i * 6} 60 60)" class:major={i % 5 === 0} />
    {/each}
    <circle class="track" cx="60" cy="60" r="52" />
    {#if f > 0}
      <circle class="lit" cx="60" cy="60" r="52" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset={1 - f} transform="rotate(-90 60 60)" />
      <circle class="head" cx={head.x} cy={head.y} r="2.6" />
    {/if}
  </svg>
  <div class="face">
    {#if caption}<div class="caption mono">{caption}</div>{/if}
    <div class="time" style:font-size={size}>
      {#each chars as c}<span class:d={/\d/.test(c)}>{c}</span>{/each}{#if tail}<span class="tail">{tail}</span>{/if}
    </div>
    {#if children}<div class="under">{@render children()}</div>{/if}
  </div>
</div>

<style>
  .dial {
    position: relative;
    width: min(100%, var(--dial, 360px));
    aspect-ratio: 1;
    margin-inline: auto;
    container-type: inline-size;
  }
  svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  line {
    stroke: var(--color-line-2);
    stroke-width: 0.5;
  }
  line.major {
    stroke: var(--color-muted);
  }
  circle {
    fill: none;
    stroke-width: 3;
  }
  .track {
    stroke: var(--color-line);
  }
  .lit {
    stroke: var(--tone);
    stroke-linecap: round;
    transition: stroke 0.4s;
  }
  .head {
    fill: var(--color-bg);
    stroke: var(--tone);
    stroke-width: 1.6;
  }
  .face {
    position: absolute;
    inset: 12%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.4cqi;
    text-align: center;
  }
  .caption {
    max-width: 60cqi;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: max(11px, 3.4cqi);
  }
  .time {
    font-family: var(--font-serif);
    line-height: 1;
    white-space: nowrap;
    letter-spacing: 0;
  }
  .time span {
    display: inline-block;
    width: 0.3em;
    text-align: center;
  }
  .time span.d {
    width: 0.56em;
  }
  .time .tail {
    width: auto;
    font-size: 0.42em;
    color: var(--color-muted);
    margin-left: 0.08em;
  }
  .under {
    font-size: max(12px, 3.6cqi);
  }
  .ringing .track {
    stroke: var(--tone);
  }
  .ringing .track,
  .ringing .time {
    animation: pulse 1s ease-in-out infinite;
  }
  .ringing .time {
    color: var(--tone);
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
</style>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { SvelteMap } from 'svelte/reactivity';
  import CompareSlider from '@/components/tool/CompareSlider.svelte';
  import { canvasToBlob, isAbort, type PageSize, type PdfDoc } from '@/engines/pdf';
  import { countChangedOff, highlightOff } from '@/tools/lib/compare-pdf/client';
  import { formatShare, visibleShare } from '@/tools/lib/compare-pdf/pixels';
  import { fitScale, pairKey, rasterOf, renderPair } from '@/tools/lib/compare-pdf/render';
  import { pairLabel, type PagePair } from '@/tools/lib/compare-pdf/text';

  interface Props {
    docs: [PdfDoc, PdfDoc];
    pairs: PagePair[];
    /** visible share of changed pixels per pair (0 = looks the same, NaN = couldn't render), shared with the report */
    scores: SvelteMap<string, number>;
  }

  let { docs, pairs, scores }: Props = $props();

  type Mode = 'side' | 'slider' | 'diff' | 'onion';
  const MODES: [Mode, string][] = [
    ['diff', 'difference'],
    ['side', 'side by side'],
    ['slider', 'slider'],
    ['onion', 'onion skin'],
  ];
  /** small renders for spotting changed pages; a changed word still moves plenty of pixels at this size */
  const scanScale = fitScale(0.6, 250_000);

  let mode = $state<Mode>('diff');
  let onlyChanged = $state(false);
  let opacity = $state(50);
  let sel = $state(0);
  let stageWidth = $state(0);
  let view = $state.raw<{ pair: PagePair; a: string | null; b: string | null; diff: string | null; sizes: (PageSize | null)[] } | null>(null);
  let loading = $state(false);
  let error = $state('');

  const keyOf = (p: PagePair) => pairKey(docs, p);
  const scanned = $derived(pairs.filter((p) => scores.has(keyOf(p))).length);
  const differing = $derived(pairs.filter((p) => (scores.get(keyOf(p)) ?? 0) > 0).length);
  const listed = $derived(pairs.flatMap((p, k) => (!onlyChanged || (scores.get(keyOf(p)) ?? 0) > 0 ? [k] : [])));
  // re-render only when the stage grows or shrinks a fair bit
  const target = $derived(Math.min(1800, Math.ceil(stageWidth / 240) * 240 * (typeof devicePixelRatio === 'number' ? Math.min(2, devicePixelRatio) : 1)));

  // start on the first page with text changes
  $effect(() => {
    const first = pairs.findIndex((p) => p.changes);
    untrack(() => (sel = Math.max(0, first)));
  });

  // background scan: every pair rendered small and pixel-diffed in a worker, in page order
  $effect(() => {
    const list = pairs;
    const pdfs = docs;
    const ctrl = new AbortController();
    untrack(async () => {
      for (const p of list) {
        const key = pairKey(pdfs, p);
        if (ctrl.signal.aborted) return;
        if (scores.has(key)) continue;
        if (p.a < 0 || p.b < 0) {
          scores.set(key, 1);
          continue;
        }
        try {
          const r = await renderPair(pdfs, [p.a, p.b], scanScale, ctrl.signal);
          const changed = await countChangedOff(rasterOf(r.a!), rasterOf(r.b!));
          r.a!.width = r.b!.width = 0;
          if (!ctrl.signal.aborted) scores.set(key, visibleShare(changed, r.width * r.height));
        } catch (e) {
          if (ctrl.signal.aborted || isAbort(e)) return;
          scores.set(key, NaN);
        }
      }
    });
    return () => ctrl.abort();
  });

  // the selected pair at screen size, debounced so flicking through pages stays light
  $effect(() => {
    const pair = pairs[sel];
    const pdfs = docs;
    const width = target;
    if (!pair || !width) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      loading = true;
      error = '';
      const urls: string[] = [];
      try {
        const r = await renderPair(pdfs, [pair.a, pair.b], (w, h) => Math.min(width / w, Math.sqrt(6_000_000 / (w * h))), ctrl.signal);
        let diff: HTMLCanvasElement | null = null;
        if (r.a && r.b) {
          const out = await highlightOff(rasterOf(r.a), rasterOf(r.b));
          diff = Object.assign(document.createElement('canvas'), { width: out.width, height: out.height });
          diff.getContext('2d')!.putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height), 0, 0);
        }
        const [a, b, d] = await Promise.all(
          [r.a, r.b, diff].map(async (c) => {
            if (!c) return null;
            const url = URL.createObjectURL(await canvasToBlob(c, 'image/png'));
            c.width = 0;
            urls.push(url);
            return url;
          }),
        );
        if (ctrl.signal.aborted) return urls.forEach((u) => URL.revokeObjectURL(u));
        release();
        view = { pair, a, b, diff: d, sizes: r.sizes };
      } catch (e) {
        urls.forEach((u) => URL.revokeObjectURL(u));
        if (!ctrl.signal.aborted && !isAbort(e)) error = (e as Error).message || 'This page couldn’t be drawn.';
      } finally {
        if (!ctrl.signal.aborted) loading = false;
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });

  function release() {
    if (!view) return;
    for (const u of [view.a, view.b, view.diff]) if (u) URL.revokeObjectURL(u);
  }
  onDestroy(release);

  function step(dir: 1 | -1) {
    if (!listed.length) return;
    const at = listed.indexOf(sel);
    sel = listed[at < 0 ? (dir > 0 ? 0 : listed.length - 1) : (at + dir + listed.length) % listed.length];
    document.querySelector(`[data-vpair="${sel}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as Element | null;
    if (e.metaKey || e.ctrlKey || e.altKey || t?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'n' || e.key === 'j') step(1);
    else if (e.key === 'p' || e.key === 'k') step(-1);
  }

  const mm = (s: PageSize) => `${Math.round((s.width * 25.4) / 72)} × ${Math.round((s.height * 25.4) / 72)} mm`;
  const sizeNote = (sizes: (PageSize | null)[]) => {
    const [a, b] = sizes;
    return a && b && (Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1) ? `Page sizes differ: ${mm(a)} vs ${mm(b)}` : '';
  };
</script>

<svelte:window onkeydown={onKey} />

{#snippet page(src: string | null, side: 0 | 1, p: PagePair)}
  <figure class="sheet">
    {#if src}
      <img {src} alt="Page {(side ? p.b : p.a) + 1} of the {side ? 'changed' : 'original'} PDF" />
    {:else}
      <div class="missing mono">no page here</div>
    {/if}
    <figcaption class="mono"><span class="dot dot-{side}" aria-hidden="true"></span>{side ? 'changed' : 'original'}{#if (side ? p.b : p.a) >= 0}&nbsp;· page {(side ? p.b : p.a) + 1}{/if}</figcaption>
  </figure>
{/snippet}

<section class="card overflow-hidden" aria-label="Visual differences">
  <header class="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line-2 px-4 py-3">
    <div class="flex items-baseline gap-3">
      {#if scanned < pairs.length}
        <span class="mono">Scanning pages · {scanned} of {pairs.length}</span>
        <div class="bar" aria-hidden="true"><span style="width: {(scanned / pairs.length) * 100}%"></span></div>
      {:else}
        <span class="pop font-serif text-3xl leading-none" class:text-ok={!differing}>{differing}</span>
        <span class="mono">of {pairs.length} {pairs.length === 1 ? 'page looks' : 'pages look'} different</span>
      {/if}
    </div>
    <div class="seg ml-auto" role="group" aria-label="Show as">
      {#each MODES as [m, label]}
        <button type="button" aria-pressed={mode === m} onclick={() => (mode = m)}>{label}</button>
      {/each}
    </div>
  </header>

  <div class="body">
    <div class="list">
      <label class="filter flex items-center gap-2 text-sm"><input type="checkbox" class="accent-(--color-sun)" bind:checked={onlyChanged} /> only changed</label>
      <div class="rows" role="group" aria-label="Pages">
        {#each listed as k (k)}
          {@const p = pairs[k]}
          {@const s = scores.get(keyOf(p))}
          <button type="button" aria-current={k === sel ? 'true' : undefined} data-vpair={k} onclick={() => (sel = k)}>
            <span class="truncate">{pairLabel(p)}</span>
            {#if p.a < 0}<span class="tag add">new</span>
            {:else if p.b < 0}<span class="tag del">gone</span>
            {:else if s === undefined}<span class="pending" aria-label="not checked yet"></span>
            {:else if Number.isNaN(s)}<span class="mono text-bad">error</span>
            {:else if s}<span class="share" style="--w: {Math.max(8, Math.min(100, Math.sqrt(s) * 100))}%">{formatShare(s)}</span>
            {:else}<span class="ok" aria-label="looks the same">✓</span>{/if}
          </button>
        {:else}
          <p class="mono px-2 py-3">{scanned < pairs.length ? 'Still scanning…' : 'No pages look different.'}</p>
        {/each}
      </div>
    </div>

    <div class="stage" bind:clientWidth={stageWidth}>
      {#if pairs[sel]}
        {@const p = pairs[sel]}
        <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <div class="nav" role="group" aria-label="Pages">
            <button type="button" onclick={() => step(-1)} aria-label="Previous page" title="Previous (P)">‹</button>
            <span class="font-serif px-1 text-xl">{pairLabel(p)}</span>
            <button type="button" onclick={() => step(1)} aria-label="Next page" title="Next (N)">›</button>
          </div>
          {#if loading}<span class="mono animate-pulse">drawing…</span>{/if}
          {#if view && view.pair === p && sizeNote(view.sizes)}<span class="mono">{sizeNote(view.sizes)}</span>{/if}
        </div>

        {#if error}
          <p class="text-bad" role="alert">{error}</p>
        {:else if view}
          {@const v = view}
          <div class="frame" class:stale={loading || v.pair !== p}>
            {#if !v.a || !v.b}
              <p class="mono mb-2">This page is only in the {v.a ? 'original' : 'changed'} PDF.</p>
              <div class="single">{@render page(v.a ?? v.b, v.a ? 0 : 1, v.pair)}</div>
            {:else if mode === 'side'}
              <div class="sbs">
                {@render page(v.a, 0, v.pair)}
                {@render page(v.b, 1, v.pair)}
              </div>
            {:else if mode === 'slider'}
              <CompareSlider before={v.a} after={v.b} beforeLabel="original" afterLabel="changed" />
            {:else if mode === 'diff'}
              <img class="diff" src={v.diff} alt="Differences on {pairLabel(v.pair)}: removed ink in red, added ink in blue" />
              <p class="legend mono">
                <span><i class="swatch red"></i>only in the original</span>
                <span><i class="swatch blue"></i>only in the changed PDF</span>
                <span><i class="swatch sun"></i>changed area</span>
              </p>
            {:else}
              <div class="onion">
                <img src={v.a} alt="Page {v.pair.a + 1} of the original PDF" />
                <img src={v.b} alt="Page {v.pair.b + 1} of the changed PDF" style="opacity: {opacity / 100}" />
              </div>
              <label class="mt-3 flex items-center gap-3 text-sm">
                <span class="mono">original</span>
                <input type="range" min="0" max="100" bind:value={opacity} class="flex-1 accent-(--color-sun)" aria-label="Opacity of the changed page" />
                <span class="mono">changed</span>
              </label>
            {/if}
          </div>
        {:else}
          <div class="placeholder mono animate-pulse">drawing pages…</div>
        {/if}
      {/if}
    </div>
  </div>
</section>

<style>
  .pop {
    animation: pop 0.35s var(--ease-spring);
  }
  @keyframes pop {
    from {
      opacity: 0.4;
      transform: translateY(4px);
    }
  }
  .bar {
    width: 120px;
    height: 4px;
    align-self: center;
    border-radius: 99px;
    background: var(--color-line);
    overflow: hidden;
    & span {
      display: block;
      height: 100%;
      background: var(--color-sun);
      transition: width 0.2s;
    }
  }
  .body {
    display: grid;
    @media (min-width: 768px) {
      grid-template-columns: 12rem minmax(0, 1fr);
    }
  }
  .list {
    min-width: 0;
    border-bottom: 1px solid var(--color-line-2);
    @media (min-width: 768px) {
      border-bottom: 0;
      border-right: 1px solid var(--color-line-2);
    }
  }
  .filter {
    padding: 10px 14px 4px;
  }
  .rows {
    display: flex;
    gap: 6px;
    padding: 8px 12px 10px;
    overflow-x: auto;
    @media (min-width: 768px) {
      flex-direction: column;
      gap: 2px;
      max-height: 72vh;
      overflow: auto;
      padding: 6px 8px 10px;
    }
    & button {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 10px;
      font: 400 13px var(--font-mono);
      color: var(--color-soft);
      text-align: left;
      background: transparent;
      border: 1px solid var(--color-line);
      border-radius: 9px;
      cursor: pointer;
      transition: color 0.2s, background-color 0.2s, border-color 0.2s;
      @media (min-width: 768px) {
        border-color: transparent;
      }
      &:hover {
        color: var(--color-chalk);
        background: var(--color-panel-2);
      }
      &[aria-current='true'] {
        color: var(--color-chalk);
        background: var(--color-panel-2);
        border-color: var(--color-sun);
      }
    }
  }
  .tag {
    padding: 1px 6px;
    font-size: 11.5px;
    border-radius: 99px;
    color: var(--color-bg);
    &.add {
      background: var(--color-ok);
    }
    &.del {
      background: var(--color-bad);
    }
  }
  .pending {
    width: 7px;
    height: 7px;
    border-radius: 99px;
    background: var(--color-muted);
    animation: blink 1.2s ease-in-out infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }
  .ok {
    color: var(--color-ok);
  }
  .share {
    position: relative;
    min-width: 52px;
    padding: 1px 6px;
    font-size: 11.5px;
    text-align: right;
    color: var(--color-sun);
    &::before {
      content: '';
      position: absolute;
      inset: auto auto -2px 0;
      width: var(--w);
      height: 2px;
      border-radius: 2px;
      background: var(--color-sun);
    }
  }

  .stage {
    min-width: 0;
    padding: 14px 16px 18px;
  }
  .nav {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    & button {
      width: 36px;
      height: 36px;
      font-size: 20px;
      color: var(--color-chalk);
      background: transparent;
      border: 0;
      border-radius: 11px;
      cursor: pointer;
      &:hover {
        background: var(--color-panel-2);
        color: var(--color-sun);
      }
    }
  }
  .frame {
    transition: opacity 0.2s;
    &.stale {
      opacity: 0.55;
    }
  }
  .frame img,
  .missing {
    display: block;
    max-width: 100%;
    margin-inline: auto;
    border-radius: 6px;
  }
  .diff,
  .single img,
  .onion img {
    max-height: 78vh;
    box-shadow: 0 0 0 1px var(--color-line-2), 0 12px 30px -12px #000a;
  }
  .sbs {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }
  .single {
    max-width: 640px;
    margin-inline: auto;
  }
  .sheet {
    margin: 0;
    & img {
      width: 100%;
      box-shadow: 0 0 0 1px var(--color-line-2);
    }
    & figcaption {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 8px;
    }
  }
  .missing {
    display: grid;
    place-items: center;
    aspect-ratio: 210 / 297;
    border: 1.5px dashed var(--color-line-2);
    background: repeating-linear-gradient(-45deg, transparent 0 8px, #f2ede40a 8px 9px);
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 99px;
  }
  .dot-0 {
    background: #e23b30;
  }
  .dot-1 {
    background: #2468f2;
  }
  .onion {
    display: grid;
    justify-items: center;
    & img {
      grid-area: 1 / 1;
    }
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 18px;
    margin-top: 12px;
    & span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    &.red {
      background: #e23b30;
    }
    &.blue {
      background: #2468f2;
    }
    &.sun {
      background: #ffd25e;
    }
  }
  .placeholder {
    display: grid;
    place-items: center;
    min-height: 320px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 14px;
  }
</style>

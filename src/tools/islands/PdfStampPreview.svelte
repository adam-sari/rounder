<script module lang="ts">
  export interface PreviewPage {
    index: number;
    /** visual size in points */
    width: number;
    height: number;
  }
  /** Draws on a context set up in page points, y up. 'under' runs before the page's own content, 'over' after. */
  export type Paint = (ctx: CanvasRenderingContext2D, page: PreviewPage, layer: 'under' | 'over') => void;
</script>

<script lang="ts">
  import { getPageSize, isAbort, renderPage, type PdfDoc } from '@/engines/pdf';

  interface Props {
    doc: PdfDoc;
    paint: Paint | null;
    /** start with two pages side by side when there's room; people can switch */
    spread?: boolean;
    /** a short line under each page */
    caption?: (pageIndex: number) => string;
    label: string;
  }

  let { doc, paint, spread = false, caption, label }: Props = $props();

  const MAX_H = 520;
  const GAP = 16;

  let stageWidth = $state(0);
  let start = $state(0);
  let shown = $state.raw<(PreviewPage & { base: HTMLCanvasElement })[]>([]);
  let views = $state<HTMLCanvasElement[]>([]);
  let failed = $state('');
  let loading = $state(true);

  let spreadChoice = $state<boolean | null>(null);
  const roomForTwo = $derived(stageWidth >= 460 && doc.numPages > 1);
  const two = $derived((spreadChoice ?? spread) && roomForTwo);
  const step = $derived(two ? 2 : 1);
  const indices = $derived(Array.from({ length: Math.min(step, doc.numPages - start) }, (_, k) => start + k));

  // a new document starts from its first page
  let lastDoc: PdfDoc | undefined;
  $effect.pre(() => {
    if (doc !== lastDoc) {
      lastDoc = doc;
      start = 0;
    }
  });
  // keep spreads aligned (1–2, 3–4…) when the layout switches
  $effect.pre(() => {
    if (start % step) start -= start % step;
  });

  // render the bare pages (transparent, so "under" marks can show through), only when page or size changes
  $effect(() => {
    const want = indices;
    const width = stageWidth;
    const d = doc;
    if (!width) return;
    const ctrl = new AbortController();
    loading = true;
    const t = setTimeout(async () => {
      try {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        const slot = want.length > 1 ? (width - GAP) / 2 : width;
        const pages = await Promise.all(
          want.map(async (index) => {
            const size = await getPageSize(d, index);
            const css = Math.min(slot, (MAX_H * size.width) / size.height);
            const base = await renderPage(d, index, { width: Math.round(css * dpr), background: 'transparent', signal: ctrl.signal });
            return { index, width: size.width, height: size.height, base };
          }),
        );
        for (const p of shown) p.base.width = 0;
        shown = pages;
        failed = '';
      } catch (e) {
        if (isAbort(e)) return;
        failed = (e as Error)?.message || "This page couldn't be drawn.";
      } finally {
        if (!ctrl.signal.aborted) loading = false;
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  });

  // composite: white paper, marks under, the page, marks over. Cheap, so it follows every paint change.
  $effect(() => {
    const p = paint;
    shown.forEach((page, k) => {
      const canvas = views[k];
      if (!canvas) return;
      const { base } = page;
      canvas.width = base.width;
      canvas.height = base.height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, base.width, base.height);
      const s = base.width / page.width;
      const layer = (which: 'under' | 'over') => {
        if (!p) return;
        ctx.save();
        ctx.setTransform(s, 0, 0, -s, 0, base.height);
        p(ctx, page, which);
        ctx.restore();
      };
      layer('under');
      ctx.drawImage(base, 0, 0);
      layer('over');
    });
  });

  $effect(() => () => {
    for (const p of shown) p.base.width = 0;
  });

  const dpr = () => Math.min(devicePixelRatio || 1, 2);
  const range = $derived(indices.length > 1 ? `Pages ${indices[0] + 1}–${indices.at(-1)! + 1}` : `Page ${start + 1}`);
</script>

<figure class="grid gap-3">
  <div class="stage" class:loading aria-busy={loading}>
    <div class="inner" bind:clientWidth={stageWidth}>
      {#if failed}
        <p class="mono px-4 py-16 text-center text-bad" role="alert">{failed}</p>
      {:else if shown.length}
        <div class="pages" style:gap={`${GAP}px`}>
          {#each shown as page, k (page.index)}
            <div class="grid justify-items-center gap-2">
              <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
              <canvas
                bind:this={views[k]}
                class="paper"
                style:width={`${page.base.width / dpr()}px`}
                role="img"
                aria-label={`${label}, page ${page.index + 1}${caption ? `: ${caption(page.index)}` : ''}`}
              ></canvas>
              {#if caption}<span class="mono text-center">{caption(page.index)}</span>{/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="sheet" aria-hidden="true"></div>
      {/if}
    </div>
  </div>

  {#if doc.numPages > 1}
    <figcaption class="pager">
      <button type="button" class="btn px-3! py-2!" disabled={start === 0} onclick={() => (start = Math.max(0, start - step))} aria-label="Previous pages">‹</button>
      <span class="mono" aria-live="polite">{range} of {doc.numPages}</span>
      <button type="button" class="btn px-3! py-2!" disabled={start + step >= doc.numPages} onclick={() => (start += step)} aria-label="Next pages">›</button>
      {#if roomForTwo}
        <div class="seg view" role="group" aria-label="Pages shown">
          <button type="button" aria-pressed={!two} onclick={() => (spreadChoice = false)} aria-label="One page, larger" title="One page">
            <svg viewBox="0 0 20 14" width="20" height="14" aria-hidden="true"><rect x="6" y="1" width="8" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
          </button>
          <button type="button" aria-pressed={two} onclick={() => (spreadChoice = true)} aria-label="Two pages side by side" title="Two pages">
            <svg viewBox="0 0 20 14" width="20" height="14" aria-hidden="true"><rect x="1.5" y="1" width="8" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /><rect x="10.5" y="1" width="8" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
          </button>
        </div>
      {/if}
    </figcaption>
  {/if}
</figure>

<style>
  .stage {
    display: grid;
    place-items: center;
    min-height: 240px;
    padding: clamp(12px, 3vw, 20px);
    border-radius: 16px;
    border: 1px solid var(--color-line-2);
    background:
      radial-gradient(circle at 50% 40%, #ffffff0a, transparent 70%),
      #141312;
  }
  .inner {
    display: grid;
    place-items: center;
    width: 100%;
  }
  .pages {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    width: 100%;
    transition: opacity 0.2s;
  }
  .loading .pages {
    opacity: 0.75;
  }
  .paper {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 3px;
    box-shadow:
      0 1px 0 #ffffff14 inset,
      0 12px 32px -12px #000c,
      0 2px 6px #0008;
  }
  .sheet {
    width: 180px;
    aspect-ratio: 1 / 1.3;
    border-radius: 4px;
    background: linear-gradient(100deg, #2a2926 30%, #34322e 50%, #2a2926 70%) 0 0 / 300% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -150% 0;
    }
  }
  .pager {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .view {
    position: absolute;
    right: 0;
    & button {
      display: grid;
      place-items: center;
      padding: 6px 10px;
    }
  }
</style>

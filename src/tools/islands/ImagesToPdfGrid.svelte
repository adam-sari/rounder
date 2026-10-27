<script module lang="ts">
  export interface ImageItem {
    id: number;
    file: File;
    /** small preview, upright; revoked when the item goes */
    thumb?: string;
    /** pixel size, upright (EXIF rotation applied) */
    width?: number;
    height?: number;
  }
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { PageLayout } from '@/tools/lib/jpg-to-pdf/layout';

  interface Props {
    items: ImageItem[];
    /** where the image lands on its page, once its size is known */
    layout: (item: ImageItem) => PageLayout | null;
    disabled?: boolean;
    onremove: (item: ImageItem) => void;
  }

  let { items = $bindable(), layout, disabled = false, onremove }: Props = $props();

  const uid = $props.id();
  let list = $state<HTMLUListElement>();
  let focus = $state(0);
  let message = $state('');
  let reduceMotion = $state(false);

  onMount(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = mq.matches;
    const onChange = () => (reduceMotion = mq.matches);
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      endDrag(false);
    };
  });

  $effect(() => {
    if (focus > items.length - 1) focus = Math.max(0, items.length - 1);
  });

  const pct = (part: number, whole: number) => `${(part / whole) * 100}%`;
  const describe = (item: ImageItem, i: number) => `${item.file.name}, page ${i + 1} of ${items.length}`;

  function move(from: number, to: number, announce = true) {
    if (disabled || to < 0 || to >= items.length || to === from) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    items = next;
    if (announce) message = `${item.file.name} moved to page ${to + 1} of ${items.length}.`;
  }

  function remove(i: number) {
    const item = items[i];
    onremove(item);
    message = `${item.file.name} removed. ${items.length} left.`;
    if (items.length) focusTile(Math.min(i, items.length - 1));
  }

  async function focusTile(i: number) {
    focus = Math.max(0, Math.min(items.length - 1, i));
    await tick();
    list?.querySelector<HTMLElement>(`[data-id="${items[focus]?.id}"] .face`)?.focus();
  }

  function columns() {
    const tiles = list?.children;
    if (!tiles?.length) return 1;
    const top = (tiles[0] as HTMLElement).offsetTop;
    let n = 0;
    while (n < tiles.length && (tiles[n] as HTMLElement).offsetTop === top) n++;
    return n;
  }

  function onkeydown(e: KeyboardEvent, i: number) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns() };
    const step = steps[e.key];
    if (step) {
      e.preventDefault();
      const to = Math.max(0, Math.min(items.length - 1, i + step));
      if (e.altKey) move(i, to);
      focusTile(to);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusTile(e.key === 'Home' ? 0 : items.length - 1);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !disabled) {
      e.preventDefault();
      remove(i);
    }
  }

  /* ---------- drag to reorder: mouse and pen right away, touch after a long press ---------- */

  interface Drag {
    id: number;
    pointerId: number;
    x0: number;
    y0: number;
    x: number;
    y: number;
    active: boolean;
    touch: boolean;
    timer?: ReturnType<typeof setTimeout>;
    original: ImageItem[];
    dx: number;
    dy: number;
    w: number;
  }
  let drag = $state<Drag | null>(null);
  let scrollFrame = 0;
  const dragItem = $derived(drag?.active ? items.find((p) => p.id === drag!.id) : undefined);

  function onpointerdown(e: PointerEvent, item: ImageItem) {
    if (disabled || e.button !== 0 || drag) return;
    drag = { id: item.id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, touch: e.pointerType === 'touch', original: items, dx: 0, dy: 0, w: 0 };
    if (drag.touch) drag.timer = setTimeout(activate, 320);
    addEventListener('pointermove', onpointermove);
    addEventListener('pointerup', onpointerup);
    addEventListener('pointercancel', onpointercancel);
  }

  function activate() {
    if (!drag || !list) return;
    const r = list.querySelector<HTMLElement>(`[data-id="${drag.id}"]`)?.getBoundingClientRect();
    if (!r) return;
    Object.assign(drag, { active: true, original: items, dx: drag.x - r.left, dy: drag.y - r.top, w: r.width });
    if (drag.touch) navigator.vibrate?.(8);
    autoScroll();
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.active) {
      const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
      if (drag.touch && dist > 10) endDrag(false); // it's a scroll
      else if (!drag.touch && dist > 6) activate();
      return;
    }
    hitTest();
  }

  // layout positions, not on-screen ones, so the flip animation can't make tiles jitter
  function hitTest() {
    if (!drag?.active || !list) return;
    const box = list.getBoundingClientRect();
    const x = drag.x - box.left;
    const y = drag.y - box.top;
    const tiles = list.children;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i] as HTMLElement;
      if (x >= t.offsetLeft && x <= t.offsetLeft + t.offsetWidth && y >= t.offsetTop && y <= t.offsetTop + t.offsetHeight) {
        const from = items.findIndex((p) => p.id === drag!.id);
        if (from !== i) move(from, i, false);
        return;
      }
    }
  }

  function autoScroll() {
    cancelAnimationFrame(scrollFrame);
    if (!drag?.active) return;
    const edge = 80;
    const v = drag.y < edge ? -(edge - drag.y) / 4 : drag.y > innerHeight - edge ? (drag.y - innerHeight + edge) / 4 : 0;
    if (v) {
      scrollBy(0, v);
      hitTest();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  // registered up front: browsers decide at touchstart whether a scroll can be cancelled
  $effect(() => {
    const node = list;
    if (!node) return;
    const block = (e: TouchEvent) => drag?.active && e.preventDefault();
    node.addEventListener('touchmove', block, { passive: false });
    return () => node.removeEventListener('touchmove', block);
  });

  function onpointerup(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointerId) endDrag(true);
  }

  function onpointercancel(e: PointerEvent) {
    if (drag && e.pointerId === drag.pointerId) endDrag(false);
  }

  function endDrag(commit: boolean) {
    if (!drag) return;
    clearTimeout(drag.timer);
    cancelAnimationFrame(scrollFrame);
    removeEventListener('pointermove', onpointermove);
    removeEventListener('pointerup', onpointerup);
    removeEventListener('pointercancel', onpointercancel);
    if (drag.active) {
      const i = items.findIndex((p) => p.id === drag!.id);
      if (!commit) items = drag.original;
      else if (drag.original[i]?.id !== drag.id) message = `${items[i].file.name} moved to page ${i + 1} of ${items.length}.`;
      focus = Math.max(0, i);
    }
    drag = null;
  }
</script>

{#snippet sheet(item: ImageItem)}
  {@const L = layout(item)}
  {#if L && item.thumb}
    {@const ar = L.width / L.height}
    <span class="sheet" style:width="{ar >= 1 ? 100 : ar * 100}%" style:height="{ar >= 1 ? 100 / ar : 100}%">
      <span class="box" style:left={pct(L.box.x, L.width)} style:top={pct(L.box.y, L.height)} style:width={pct(L.box.w, L.width)} style:height={pct(L.box.h, L.height)}>
        <img
          src={item.thumb}
          alt=""
          draggable="false"
          style:left={pct(L.image.x - L.box.x, L.box.w)}
          style:top={pct(L.image.y - L.box.y, L.box.h)}
          style:width={pct(L.image.w, L.box.w)}
          style:height={pct(L.image.h, L.box.h)}
        />
      </span>
    </span>
  {:else}
    <span class="sheet loading"></span>
  {/if}
{/snippet}

<ul bind:this={list} class="tiles" class:dragging={drag?.active} aria-label="Pages, in order">
  {#each items as item, i (item.id)}
    <li class="tile" class:ghosted={drag?.active && drag.id === item.id} data-id={item.id} animate:flip={{ duration: reduceMotion ? 0 : 220 }}>
      <button
        type="button"
        class="face"
        tabindex={i === focus ? 0 : -1}
        aria-label={describe(item, i)}
        aria-describedby="{uid}-keys"
        onfocus={() => (focus = i)}
        onkeydown={(e) => onkeydown(e, i)}
        onpointerdown={(e) => onpointerdown(e, item)}
        oncontextmenu={(e) => drag && e.preventDefault()}
      >
        <span class="frame"><span class="stage">{@render sheet(item)}</span></span>
      </button>
      <button type="button" tabindex="-1" class="del" title="Remove (Delete)" aria-label="Remove {item.file.name}" {disabled} onclick={() => remove(i)}>
        <svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
      </button>
      <span class="caption">
        <button type="button" tabindex="-1" class="nudge" aria-label="Move earlier" disabled={disabled || i === 0} onclick={() => move(i, i - 1)}>‹</button>
        <span class="min-w-0 text-center">
          <span class="mono num">{i + 1}</span>
          <span class="mono name" title={item.file.name}>{item.file.name}</span>
        </span>
        <button type="button" tabindex="-1" class="nudge" aria-label="Move later" disabled={disabled || i === items.length - 1} onclick={() => move(i, i + 1)}>›</button>
      </span>
    </li>
  {/each}
</ul>

<p id="{uid}-keys" class="sr-only">Arrow keys move between images. Alt+arrow keys move the image to another page. Delete removes it.</p>
<p class="sr-only" aria-live="polite">{message}</p>

{#if dragItem && drag}
  <div class="ghost" style:left="{drag.x - drag.dx}px" style:top="{drag.y - drag.dy}px" style:width="{drag.w}px" aria-hidden="true">
    <span class="frame"><span class="stage">{@render sheet(dragItem)}</span></span>
  </div>
{/if}

<style>
  .tiles {
    /* the offsetParent hitTest() measures against */
    position: relative;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(150px, calc(50% - 6px)), 1fr));
    gap: 12px;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .dragging {
    cursor: grabbing;
    user-select: none;
  }
  .tile {
    position: relative;
    display: grid;
    gap: 6px;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .ghosted {
    opacity: 0.3;
  }
  .face {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: grab;
    border-radius: 14px;
    touch-action: manipulation;
  }
  .frame {
    position: relative;
    display: block;
    aspect-ratio: 1;
    border-radius: 14px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    transition: border-color 0.2s;
  }
  .face:hover .frame {
    border-color: var(--color-line-2);
  }
  .stage {
    position: absolute;
    inset: 12px;
  }
  .sheet {
    position: absolute;
    inset: 0;
    margin: auto;
    background: #fff;
    border-radius: 2px;
    box-shadow: 0 1px 2px #0006, 0 6px 18px -6px #000a;
    transition: width 0.4s var(--ease-spring), height 0.4s var(--ease-spring);
  }
  .loading {
    width: 70.7%;
    height: 100%;
    background: linear-gradient(100deg, #2a2926 30%, #34332f 50%, #2a2926 70%) 0 0 / 300% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to { background-position: -150% 0; }
  }
  .box {
    position: absolute;
    overflow: hidden;
    transition: all 0.4s var(--ease-spring);
  }
  .box img {
    position: absolute;
    max-width: none;
    transition: all 0.4s var(--ease-spring);
    animation: arrive 0.35s ease-out;
  }
  @keyframes arrive {
    from { opacity: 0; }
  }
  .del {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid var(--color-line-2);
    background: #131211d9;
    color: var(--color-soft);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s, border-color 0.15s;
    & svg {
      width: 12px;
      height: 12px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
    }
    &:hover {
      color: var(--color-bad);
      border-color: var(--color-bad);
    }
  }
  .tile:hover .del,
  .tile:focus-within .del,
  .del:focus-visible {
    opacity: 1;
  }
  @media (hover: none) {
    .del {
      opacity: 1;
    }
  }
  .caption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }
  .num {
    display: block;
    color: var(--color-chalk);
  }
  .name {
    display: block;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nudge {
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    border: 0;
    background: none;
    color: var(--color-muted);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    &:hover:not(:disabled) {
      color: var(--color-chalk);
      background: var(--color-panel-2);
    }
    &:disabled {
      opacity: 0.25;
      cursor: default;
    }
  }
  .ghost {
    position: fixed;
    z-index: 50;
    pointer-events: none;
    transform: rotate(-2deg) scale(1.04);
    filter: drop-shadow(0 18px 30px #000c);
    & .frame {
      border-color: var(--color-sun);
    }
  }
</style>

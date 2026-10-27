<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { Attachment } from 'svelte/attachments';
  import { getThumbnail, isAbort, normalizeRotation, renderPage, type PageRef, type PdfDoc } from '@/engines/pdf';

  interface Props {
    /** the pages in order; reordering, rotating and removing update it */
    pages: PageRef[];
    /** ids of the selected pages */
    selected?: string[];
    selectable?: boolean;
    /** drag (long-press on touch) or Alt+arrow keys to move pages */
    reorder?: boolean;
    /** per-page rotate button, R / Shift+R keys */
    rotate?: boolean;
    /** per-page delete button, Delete key */
    remove?: boolean;
    /** double-click or Enter for a large view */
    preview?: boolean;
    /** "bad" marks selected pages as going away (dimmed, red cross), e.g. for deleting */
    selectTone?: 'sun' | 'bad';
    /** show "n of m selected · Select all · Clear" above the grid */
    toolbar?: boolean;
    /** thumbnail width in css px */
    size?: number;
    /** caption under each page; default is its page number (plus file name when mixing files) */
    label?: (page: PageRef, index: number) => string;
    /** extra layer over each thumbnail, e.g. a badge */
    overlay?: Snippet<[PageRef, number]>;
    ariaLabel?: string;
  }

  let {
    pages = $bindable(),
    selected = $bindable([]),
    selectable = false,
    reorder = false,
    rotate = false,
    remove = false,
    preview = true,
    selectTone = 'sun',
    toolbar = true,
    size = 150,
    label,
    overlay,
    ariaLabel = 'Pages',
  }: Props = $props();

  const uid = $props.id();
  const DOC_COLORS = ['--color-image', '--color-everyday', '--color-dev', '--color-ai', '--color-pdf', '--color-text', '--color-files'];

  let list = $state<HTMLUListElement>();
  let focus = $state(0);
  let anchor = -1;
  let message = $state('');
  let reduceMotion = $state(false);
  let thumbPx = 240;

  const chosen = $derived(new Set(selected));
  const docOrder = $derived([...new Set(pages.map((p) => p.doc))]);
  const mixed = $derived(docOrder.length > 1);

  onMount(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = mq.matches;
    const onChange = () => (reduceMotion = mq.matches);
    mq.addEventListener('change', onChange);
    thumbPx = Math.min(640, Math.ceil((size * Math.min(devicePixelRatio || 1, 3)) / 80) * 80);
    return () => {
      mq.removeEventListener('change', onChange);
      observer?.disconnect();
      endDrag(false);
    };
  });

  $effect(() => {
    if (focus > pages.length - 1) focus = Math.max(0, pages.length - 1);
  });

  const defaultLabel = (p: PageRef) => (mixed ? `${shortName(p.doc)} · ${p.pageIndex + 1}` : `${p.pageIndex + 1}`);
  const shortName = (doc: PdfDoc) => {
    const n = doc.name.replace(/\.pdf$/i, '') || 'file';
    return n.length > 14 ? `${n.slice(0, 12)}…` : n;
  };
  const describe = (p: PageRef, i: number) =>
    `Page ${p.pageIndex + 1}${mixed && p.doc.name ? ` of ${p.doc.name}` : ''}, position ${i + 1} of ${pages.length}${p.rotation ? `, rotated ${p.rotation} degrees` : ''}`;

  /* ---------- thumbnails: rendered when scrolled near, cancelled when scrolled past ---------- */

  let thumbs = $state<Record<string, { url: string; width: number; height: number }>>({});
  let failed = $state<Record<string, boolean>>({});
  let observer: IntersectionObserver | undefined;
  const onVisible = new Map<Element, () => void>();
  const loading = new Map<Element, AbortController>();
  const attachments = new Map<string, Attachment<HTMLElement>>();

  function io() {
    observer ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) onVisible.get(e.target)?.();
          else {
            loading.get(e.target)?.abort();
            loading.delete(e.target);
          }
        }
      },
      { rootMargin: '400px 0px' },
    );
    return observer;
  }

  // one attachment per page, so replacing a PageRef (e.g. on rotate) doesn't re-observe
  function lazyThumb(doc: PdfDoc, pageIndex: number): Attachment<HTMLElement> {
    const key = `${doc.id}:${pageIndex}`;
    let attach = attachments.get(key);
    if (!attach) {
      attach = (node) => {
        node.dataset.thumb = key;
        onVisible.set(node, () => {
          if (thumbs[key] || loading.has(node)) return;
          const ctrl = new AbortController();
          loading.set(node, ctrl);
          getThumbnail(doc, pageIndex, { width: thumbPx, signal: ctrl.signal })
            .then((t) => {
              thumbs[key] = t;
              io().unobserve(node);
            })
            .catch((e) => {
              if (!isAbort(e)) failed[key] = true;
            })
            .finally(() => loading.get(node) === ctrl && loading.delete(node));
        });
        io().observe(node);
        return () => {
          io().unobserve(node);
          onVisible.delete(node);
          loading.get(node)?.abort();
        };
      };
      attachments.set(key, attach);
    }
    return attach;
  }

  // the thumbnail cache revokes URLs it evicts (past 400 pages): a new <img> for one fails, so render it again
  function refresh(key: string) {
    delete thumbs[key];
    list?.querySelectorAll(`[data-thumb="${CSS.escape(key)}"]`).forEach((node) => io().observe(node));
  }

  // keeps spinning forward: 270° → 0° animates +90°, not −270°
  const spins = new Map<string, number>();
  function spin(p: PageRef) {
    const prev = spins.get(p.id) ?? p.rotation;
    let delta = normalizeRotation(p.rotation - prev);
    if (delta > 180) delta -= 360;
    spins.set(p.id, prev + delta);
    return prev + delta;
  }

  /* ---------- selection ---------- */

  function setSelected(ids: Iterable<string>) {
    const s = new Set(ids);
    selected = pages.filter((p) => s.has(p.id)).map((p) => p.id);
  }

  function toggle(i: number, e?: { shiftKey: boolean }) {
    const id = pages[i].id;
    if (e?.shiftKey && anchor >= 0 && anchor < pages.length) {
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
      setSelected([...selected, ...pages.slice(a, b + 1).map((p) => p.id)]);
    } else {
      setSelected(chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
      anchor = i;
    }
  }

  /* ---------- edits ---------- */

  function move(from: number, to: number, announce = true) {
    if (to < 0 || to >= pages.length || to === from) return;
    const next = [...pages];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    pages = next;
    if (announce) message = `${describe(p, to).split(',')[0]} moved to position ${to + 1} of ${pages.length}.`;
  }

  function turn(i: number, by: number) {
    const p = pages[i];
    const rotation = normalizeRotation(p.rotation + by);
    pages = pages.map((q, j) => (j === i ? { ...q, rotation } : q));
    message = `Page ${p.pageIndex + 1} rotated to ${rotation} degrees.`;
  }

  function drop(i: number) {
    const p = pages[i];
    pages = pages.filter((_, j) => j !== i);
    selected = selected.filter((id) => id !== p.id);
    message = `Page ${p.pageIndex + 1} removed. ${pages.length} left.`;
    if (pages.length) focusTile(Math.min(i, pages.length - 1));
  }

  async function focusTile(i: number) {
    focus = Math.max(0, Math.min(pages.length - 1, i));
    await tick();
    list?.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(pages[focus].id)}"] .face`)?.focus();
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
      if (e.altKey && reorder) {
        const to = Math.max(0, Math.min(pages.length - 1, i + step));
        move(i, to);
        focusTile(to);
      } else focusTile(i + step);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusTile(e.key === 'Home' ? 0 : pages.length - 1);
    } else if (e.key === ' ' && selectable) {
      e.preventDefault();
      toggle(i, e);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (preview) openPreview(i);
      else if (selectable) toggle(i, e);
    } else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey) && selectable) {
      e.preventDefault();
      setSelected(pages.map((p) => p.id));
    } else if (e.key === 'Escape' && selectable && selected.length) {
      selected = [];
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && remove) {
      e.preventDefault();
      drop(i);
    } else if ((e.key === 'r' || e.key === 'R') && rotate && !e.ctrlKey && !e.metaKey) {
      turn(i, e.shiftKey ? -90 : 90);
    }
  }

  /* ---------- drag to reorder (pointer events: mouse, pen, touch via long-press) ---------- */

  interface Drag {
    id: string;
    pointerId: number;
    x0: number;
    y0: number;
    x: number;
    y: number;
    active: boolean;
    touch: boolean;
    timer?: ReturnType<typeof setTimeout>;
    original: PageRef[];
    dx: number;
    dy: number;
    w: number;
  }
  let drag = $state<Drag | null>(null);
  let justDragged = false;
  let scrollFrame = 0;
  const dragPage = $derived(drag?.active ? pages.find((p) => p.id === drag!.id) : undefined);

  function onpointerdown(e: PointerEvent, page: PageRef) {
    if (!reorder || e.button !== 0 || drag) return;
    drag = { id: page.id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, touch: e.pointerType === 'touch', original: pages, dx: 0, dy: 0, w: 0 };
    if (drag.touch) drag.timer = setTimeout(activate, 320);
    addEventListener('pointermove', onpointermove);
    addEventListener('pointerup', onpointerup);
    addEventListener('pointercancel', onpointercancel);
  }

  function activate() {
    if (!drag || !list) return;
    const tile = list.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(drag.id)}"]`);
    const r = tile?.getBoundingClientRect();
    if (!r) return;
    Object.assign(drag, { active: true, original: pages, dx: drag.x - r.left, dy: drag.y - r.top, w: r.width });
    if (drag.touch) navigator.vibrate?.(8);
    autoScroll();
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    if (!drag.active) {
      if (drag.touch && dist > 10) endDrag(false); // it's a scroll
      else if (!drag.touch && dist > 6) activate();
      return;
    }
    hitTest();
  }

  // compares against layout positions (offsetLeft/Top ignore the flip animation's transforms)
  function hitTest() {
    if (!drag?.active || !list) return;
    const box = list.getBoundingClientRect();
    const x = drag.x - box.left;
    const y = drag.y - box.top;
    const tiles = list.children;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i] as HTMLElement;
      if (x >= t.offsetLeft && x <= t.offsetLeft + t.offsetWidth && y >= t.offsetTop && y <= t.offsetTop + t.offsetHeight) {
        const from = pages.findIndex((p) => p.id === drag!.id);
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

  function blockScroll(e: TouchEvent) {
    if (drag?.active) e.preventDefault();
  }

  // registered before any touch starts: browsers decide at touchstart whether a scroll can be cancelled
  $effect(() => {
    const node = list;
    if (!reorder || !node) return;
    node.addEventListener('touchmove', blockScroll, { passive: false });
    return () => node.removeEventListener('touchmove', blockScroll);
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
      justDragged = true;
      setTimeout(() => (justDragged = false));
      const i = pages.findIndex((p) => p.id === drag!.id);
      if (!commit) pages = drag.original;
      else if (drag.original[i]?.id !== drag.id) message = `${describe(pages[i], i).split(',')[0]} moved to position ${i + 1} of ${pages.length}.`;
      focus = Math.max(0, i);
    }
    drag = null;
  }

  /* ---------- large preview ---------- */

  let dialog = $state<HTMLDialogElement>();
  let stage = $state<HTMLDivElement>();
  let viewing = $state<number | null>(null);
  let rendering = $state(false);
  let previewError = $state('');

  function openPreview(i: number) {
    viewing = i;
    dialog?.showModal();
  }

  $effect(() => {
    const index = viewing;
    if (index === null || !stage) return;
    const page = pages[index];
    if (!page) return;
    const ctrl = new AbortController();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    rendering = true;
    previewError = '';
    renderPage(page.doc, page.pageIndex, {
      width: stage.clientWidth * dpr,
      height: Math.max(200, innerHeight - 190) * dpr,
      rotation: page.rotation,
      signal: ctrl.signal,
    })
      .then((canvas) => {
        canvas.style.width = `${canvas.width / dpr}px`;
        canvas.className = 'pv-canvas';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', describe(page, index));
        stage!.replaceChildren(canvas);
        rendering = false;
      })
      .catch((e) => {
        if (isAbort(e)) return;
        previewError = (e as Error).message;
        rendering = false;
      });
    return () => ctrl.abort();
  });
</script>

{#if selectable && toolbar}
  <div class="bar">
    <span class="mono" aria-live="polite">{selected.length} of {pages.length} {selectTone === 'bad' ? 'marked' : 'selected'}</span>
    <span class="flex gap-1">
      <button type="button" class="link" onclick={() => setSelected(pages.map((p) => p.id))} disabled={selected.length === pages.length}>Select all</button>
      <button type="button" class="link" onclick={() => (selected = [])} disabled={!selected.length}>Clear</button>
    </span>
  </div>
{/if}

<ul
  bind:this={list}
  class="grid-pages"
  class:dragging={drag?.active}
  class:tone-bad={selectTone === 'bad'}
  style:--thumb="{size}px"
  aria-label={ariaLabel}
>
  {#each pages as page, i (page.id)}
    {@const key = `${page.doc.id}:${page.pageIndex}`}
    {@const thumb = thumbs[key]}
    {@const isOn = chosen.has(page.id)}
    <li
      class="tile"
      class:on={isOn}
      class:ghosted={drag?.active && drag.id === page.id}
      data-page-id={page.id}
      animate:flip={{ duration: reduceMotion ? 0 : 220 }}
    >
      <button
        type="button"
        class="face"
        tabindex={i === focus ? 0 : -1}
        aria-pressed={selectable ? isOn : undefined}
        aria-label={describe(page, i)}
        aria-describedby="{uid}-keys"
        onfocus={() => (focus = i)}
        onclick={(e) => {
          if (justDragged) return;
          focus = i;
          if (selectable) toggle(i, e);
          else if (preview && e.detail === 0) openPreview(i);
        }}
        ondblclick={() => preview && openPreview(i)}
        onkeydown={(e) => onkeydown(e, i)}
        onpointerdown={(e) => onpointerdown(e, page)}
        oncontextmenu={(e) => drag && e.preventDefault()}
      >
        <span class="frame" {@attach lazyThumb(page.doc, page.pageIndex)}>
          {#if mixed}<span class="stripe" style:background="var({DOC_COLORS[docOrder.indexOf(page.doc) % DOC_COLORS.length]})"></span>{/if}
          {#if thumb}
            <img src={thumb.url} alt="" draggable="false" width={thumb.width} height={thumb.height} style:transform="rotate({spin(page)}deg)" onerror={() => refresh(key)} />
          {:else if failed[key]}
            <span class="sheet broken mono">can't draw</span>
          {:else}
            <span class="sheet" style:transform="rotate({spin(page)}deg)"></span>
          {/if}
          {#if selectable}
            <span class="check" aria-hidden="true">
              {#if selectTone === 'bad'}
                <svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
              {:else}
                <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
              {/if}
            </span>
          {/if}
          {@render overlay?.(page, i)}
        </span>
      </button>

      {#if rotate || remove}
        <span class="actions">
          {#if rotate}
            <button type="button" tabindex="-1" title="Rotate (R)" aria-label="Rotate page {page.pageIndex + 1}" onclick={() => turn(i, 90)}>
              <svg viewBox="0 0 16 16"><path d="M13 3.5V7H9.5" /><path d="M12.6 7A5 5 0 1 0 12 10.5" /></svg>
            </button>
          {/if}
          {#if remove}
            <button type="button" tabindex="-1" class="del" title="Remove (Delete)" aria-label="Remove page {page.pageIndex + 1}" onclick={() => drop(i)}>
              <svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
            </button>
          {/if}
        </span>
      {/if}

      <span class="caption">
        {#if reorder}
          <button type="button" tabindex="-1" class="nudge" aria-label="Move earlier" disabled={i === 0} onclick={() => move(i, i - 1)}>‹</button>
        {/if}
        <span class="mono num">{label ? label(page, i) : defaultLabel(page)}</span>
        {#if reorder}
          <button type="button" tabindex="-1" class="nudge" aria-label="Move later" disabled={i === pages.length - 1} onclick={() => move(i, i + 1)}>›</button>
        {/if}
      </span>
    </li>
  {/each}
</ul>

<p id="{uid}-keys" class="sr-only">
  Arrow keys move between pages.{selectable ? ' Space selects, Shift+click selects a range, Ctrl+A selects all.' : ''}{reorder ? ' Alt+arrow keys move the page.' : ''}{rotate ? ' R rotates.' : ''}{remove ? ' Delete removes.' : ''}{preview ? ' Enter opens a large preview.' : ''}
</p>
<p class="sr-only" aria-live="polite">{message}</p>

{#if dragPage && drag}
  {@const t = thumbs[`${dragPage.doc.id}:${dragPage.pageIndex}`]}
  <div class="ghost" style:left="{drag.x - drag.dx}px" style:top="{drag.y - drag.dy}px" style:width="{drag.w}px" aria-hidden="true">
    <span class="frame">
      {#if t}<img src={t.url} alt="" style:transform="rotate({dragPage.rotation}deg)" onerror={() => refresh(`${dragPage.doc.id}:${dragPage.pageIndex}`)} />{:else}<span class="sheet"></span>{/if}
    </span>
  </div>
{/if}

{#if preview}
  <dialog
    bind:this={dialog}
    class="pv"
    aria-label="Page preview"
    onclose={() => {
      viewing = null;
      stage?.replaceChildren();
    }}
    onclick={(e) => {
      // a click on the backdrop lands on the dialog itself, outside its box
      const r = dialog!.getBoundingClientRect();
      if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog!.close();
    }}
    onkeydown={(e) => {
      if (viewing === null) return;
      if (e.key === 'ArrowRight' && viewing < pages.length - 1) viewing++;
      if (e.key === 'ArrowLeft' && viewing > 0) viewing--;
    }}
  >
    {#if viewing !== null && pages[viewing]}
      {@const page = pages[viewing]}
      <div class="pv-head">
        <span class="mono">{label ? label(page, viewing) : `Page ${page.pageIndex + 1}`}{mixed && page.doc.name ? ` · ${page.doc.name}` : ''} — {viewing + 1} of {pages.length}</span>
        <button type="button" class="btn pv-close" onclick={() => dialog?.close()} aria-label="Close preview">✕</button>
      </div>
    {/if}
    <div class="pv-stage" class:busy={rendering} bind:this={stage}></div>
    {#if previewError}<p class="mono err">{previewError}</p>{/if}
    {#if viewing !== null}
      <div class="pv-nav">
        <button type="button" class="btn" disabled={viewing === 0} onclick={() => viewing!--}>‹ Previous</button>
        {#if selectable && pages[viewing]}
          {@const on = chosen.has(pages[viewing].id)}
          <button type="button" class="btn" aria-pressed={on} onclick={() => toggle(viewing!)}>{on ? (selectTone === 'bad' ? 'Unmark' : 'Deselect') : selectTone === 'bad' ? 'Mark' : 'Select'}</button>
        {/if}
        <button type="button" class="btn" disabled={viewing === pages.length - 1} onclick={() => viewing!++}>Next ›</button>
      </div>
    {/if}
  </dialog>
{/if}

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
  }
  .link {
    font: 400 12.5px var(--font-mono);
    color: var(--color-soft);
    background: none;
    border: 0;
    padding: 4px 6px;
    border-radius: 6px;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }

  .grid-pages {
    /* the offsetParent of the tiles, which hitTest() measures against */
    position: relative;
    display: grid;
    /* at least two columns even on a 360px phone */
    grid-template-columns: repeat(auto-fill, minmax(min(var(--thumb), calc(50% - 6px)), 1fr));
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
  .face {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    border-radius: 14px;
    touch-action: manipulation;
  }
  .frame {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    padding: 12px;
    overflow: hidden;
    border-radius: 14px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    transition: border-color 0.2s, background-color 0.2s;
  }
  .face:hover .frame {
    border-color: var(--color-line-2);
  }
  .on .frame {
    border-color: var(--color-sun);
    box-shadow: 0 0 0 1px var(--color-sun);
    background: #ffd25e0f;
  }
  .tone-bad .on .frame {
    border-color: var(--color-bad);
    box-shadow: 0 0 0 1px var(--color-bad);
    background: #ff7a6b10;
  }
  .stripe {
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
  }
  .frame img,
  .sheet {
    max-width: 100%;
    max-height: 100%;
    background: #fff;
    border-radius: 2px;
    box-shadow: 0 1px 2px #0006, 0 6px 18px -6px #000a;
    transition: transform 0.45s var(--ease-spring), opacity 0.2s, filter 0.2s;
  }
  .frame img {
    width: auto;
    height: auto;
    object-fit: contain;
    animation: arrive 0.35s ease-out;
  }
  .tone-bad .on img {
    opacity: 0.35;
    filter: grayscale(1);
  }
  @keyframes arrive {
    from { opacity: 0; transform: translateY(4px) scale(0.98); }
  }
  .sheet {
    display: grid;
    place-items: center;
    height: 100%;
    aspect-ratio: 1 / 1.414;
    background: linear-gradient(100deg, #2a2926 30%, #34332f 50%, #2a2926 70%) 0 0 / 300% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  .broken {
    animation: none;
    background: var(--color-panel);
    color: var(--color-bad);
    font-size: 11px;
  }
  @keyframes shimmer {
    to { background-position: -150% 0; }
  }
  .check {
    position: absolute;
    top: 8px;
    left: 8px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1.5px solid #f2ede499;
    background: #131211aa;
    transition: transform 0.25s var(--ease-spring), background 0.15s;
    & svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: var(--color-bg);
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0;
    }
  }
  .on .check {
    border-color: var(--color-sun);
    background: var(--color-sun);
    transform: scale(1.08);
    & svg { opacity: 1; }
  }
  .tone-bad .on .check {
    border-color: var(--color-bad);
    background: var(--color-bad);
  }

  .actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s;
    & button {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid var(--color-line-2);
      background: #131211e6;
      color: var(--color-chalk);
      cursor: pointer;
      &:hover { border-color: var(--color-sun); color: var(--color-sun); }
      &.del:hover { border-color: var(--color-bad); color: var(--color-bad); }
    }
    & svg {
      width: 15px;
      height: 15px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  }
  .tile:hover .actions,
  .tile:focus-within .actions {
    opacity: 1;
  }

  .caption {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 24px;
  }
  .num {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-soft);
  }
  .on .num {
    color: var(--color-sun);
  }
  .tone-bad .on .num {
    color: var(--color-bad);
    text-decoration: line-through;
  }
  .nudge {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 0;
    background: none;
    color: var(--color-muted);
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
    &:hover:not(:disabled) { color: var(--color-sun); background: var(--color-panel-2); }
    &:disabled { visibility: hidden; }
  }
  .tile:hover .nudge,
  .tile:focus-within .nudge {
    opacity: 1;
  }
  @media (hover: none) {
    .actions,
    .nudge {
      opacity: 1;
    }
  }

  .ghosted .frame {
    border-style: dashed;
    border-color: var(--color-sun);
    background: #ffd25e0a;
  }
  .ghosted .frame > :not(.stripe) {
    opacity: 0.2;
  }
  .ghost {
    position: fixed;
    z-index: 50;
    pointer-events: none;
    transform: rotate(-2.5deg) scale(1.04);
    filter: drop-shadow(0 18px 30px #000c);
    & .frame {
      border-color: var(--color-sun);
    }
  }

  .pv {
    width: min(1000px, calc(100vw - 24px));
    max-width: none;
    max-height: calc(100dvh - 24px);
    margin: auto;
    padding: 14px;
    color: var(--color-chalk);
    background: var(--color-panel);
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    &::backdrop {
      background: #0b0a09d9;
      backdrop-filter: blur(3px);
    }
    &[open] {
      animation: pop 0.25s var(--ease-spring);
    }
  }
  @keyframes pop {
    from { opacity: 0; transform: scale(0.96); }
  }
  .pv-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .pv-close {
    padding: 8px 12px;
  }
  .pv-stage {
    display: grid;
    place-items: center;
    min-height: 200px;
    transition: opacity 0.2s;
    &.busy {
      opacity: 0.5;
    }
    & :global(.pv-canvas) {
      max-width: 100%;
      height: auto;
      background: #fff;
      border-radius: 3px;
      box-shadow: 0 10px 40px -10px #000;
    }
  }
  .pv-nav {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .err {
    color: var(--color-bad);
    text-align: center;
  }
</style>

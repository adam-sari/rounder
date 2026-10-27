<script lang="ts">
  import { tick } from 'svelte';
  import { isAbort, renderPage, type PdfDoc } from '@/engines/pdf';
  import { baseline, clampBox, cornerHandles, fitInside, handles, inkPath, linePaths, markPath, resizeBox, smoothPath, snapAngle, snapBox, snapTargets, textLines, type Handle } from './geometry';
  import { boundsOf, cssFonts, describe, HIGHLIGHT_OPACITY, type Box, type LineObj, type OverlayObject, type PageInfo } from './model';
  import { clickTools, stickyTools, type Editor } from './editor.svelte';

  interface Props {
    ed: Editor;
    doc: PdfDoc;
    index: number;
    info: PageInfo;
    /** css px per point */
    k: number;
    /** close enough to the viewport to draw */
    near: boolean;
    /** id of the keyboard help text */
    describedby?: string;
  }

  let { ed, doc, index, info, k, near, describedby }: Props = $props();

  type Pt = { x: number; y: number };
  type Drag =
    | { kind: 'move'; o: OverlayObject; start: OverlayObject; from: Pt; moved: boolean; xs: number[]; ys: number[] }
    | { kind: 'resize'; o: OverlayObject; start: OverlayObject; handle: Handle; from: Pt; moved: boolean }
    | { kind: 'end'; o: LineObj; end: 1 | 2; moved: boolean }
    | { kind: 'draw' }
    | { kind: 'ink' }
    /** placing or click-creating happens on release, so a touch that scrolls the page doesn't drop anything */
    | { kind: 'tap'; from: Pt };

  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  let el = $state<HTMLDivElement>();
  let paper = $state<HTMLDivElement>();
  let typing = $state<HTMLTextAreaElement>();
  let drawnAt = $state(0);
  let failed = $state(false);

  let drag: (Drag & { pointer: number }) | null = null;
  let draft = $state<{ a: Pt; b: Pt } | null>(null);
  let ink: number[] = [];
  let inkD = $state('');
  let guides = $state<{ x: number | null; y: number | null }>({ x: null, y: null });
  let hover = $state<Pt | null>(null);

  const mine = $derived(ed.objects.filter((o) => o.page === index));
  const sel = $derived(ed.current?.page === index ? ed.current : null);
  const editingObj = $derived(sel && ed.editing === sel.id && sel.kind === 'text' ? sel : null);
  /** one screen pixel, in points */
  const px = $derived(1 / k);

  // drawn by pdf.js at screen resolution while near the viewport, dropped when far away
  $effect(() => {
    const host = paper;
    if (!host) return;
    if (!near) return drop(host);
    const scale = k;
    if (scale === drawnAt) return;
    const ctrl = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          const canvas = await renderPage(doc, index, { width: Math.round(info.w * scale * devicePixelRatio), signal: ctrl.signal });
          drop(host);
          host.append(canvas);
          drawnAt = scale;
          failed = false;
        } catch (e) {
          if (!isAbort(e)) failed = true;
        }
      },
      drawnAt ? 150 : 0, // zooming: wait until it settles
    );
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });

  // free the page's pixels as soon as it leaves, not at the next garbage collection
  $effect(() => {
    const host = paper;
    return () => host?.querySelectorAll('canvas').forEach((c) => (c.width = 0));
  });

  function drop(host: HTMLElement) {
    for (const c of host.querySelectorAll('canvas')) c.width = 0;
    host.replaceChildren();
    drawnAt = 0;
  }

  // a drag must not scroll the viewer on touch screens; registered up front because
  // browsers decide whether a touch may scroll when it starts
  $effect(() => {
    const node = el;
    if (!node) return;
    const stop = (e: TouchEvent) => {
      if (drag && drag.kind !== 'tap') e.preventDefault();
    };
    node.addEventListener('touchmove', stop, { passive: false });
    return () => node.removeEventListener('touchmove', stop);
  });

  $effect(() => {
    if (!typing) return;
    typing.focus({ preventScroll: true });
    typing.setSelectionRange(typing.value.length, typing.value.length);
  });

  function point(e: { clientX: number; clientY: number }): Pt {
    const b = el!.getBoundingClientRect();
    const s = info.w / b.width;
    return { x: (e.clientX - b.left) * s, y: (e.clientY - b.top) * s };
  }

  const onPage = (p: Pt): Pt => ({ x: Math.min(Math.max(p.x, 0), info.w), y: Math.min(Math.max(p.y, 0), info.h) });

  async function focusSelected() {
    await tick();
    el?.querySelector<SVGElement>(`[data-id="${ed.selected}"]`)?.focus({ preventScroll: true });
  }

  function begin(e: PointerEvent, d: Drag) {
    drag = { ...d, pointer: e.pointerId };
    el!.setPointerCapture(e.pointerId);
  }

  function done() {
    if (!stickyTools.includes(ed.tool)) ed.tool = 'select';
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || drag) return;
    const t = e.target as Element;
    if (t.closest('textarea')) return;
    if (ed.editing) ed.stopEditing();
    const p = point(e);
    if (ed.pending) {
      e.preventDefault();
      begin(e, { kind: 'tap', from: p });
      return;
    }
    const handle = t.closest('[data-handle]')?.getAttribute('data-handle');
    if (handle && sel) {
      e.preventDefault();
      if (sel.kind === 'line') begin(e, { kind: 'end', o: sel, end: handle === 'p1' ? 1 : 2, moved: false });
      else begin(e, { kind: 'resize', o: sel, start: $state.snapshot(sel) as OverlayObject, handle: handle as Handle, from: p, moved: false });
      return;
    }
    const hitId = t.closest('[data-id]')?.getAttribute('data-id');
    const hit = hitId ? ed.find(hitId) : undefined;
    const tool = ed.tool;
    if (tool === 'select' || (hit?.kind === 'text' && (tool === 'text' || tool === 'name' || tool === 'date'))) {
      if (!hit) {
        ed.selected = null;
        return;
      }
      e.preventDefault();
      ed.selected = hit.id;
      if (tool !== 'select') {
        ed.startEditing(hit.id);
        return;
      }
      const { xs, ys } = snapTargets(info.w, info.h, mine.filter((o) => o !== hit).map(boundsOf));
      begin(e, { kind: 'move', o: hit, start: $state.snapshot(hit) as OverlayObject, from: p, moved: false, xs, ys });
      void focusSelected();
      return;
    }
    e.preventDefault();
    ed.selected = null;
    if (clickTools.includes(tool)) {
      begin(e, { kind: 'tap', from: p });
    } else if (tool === 'ink') {
      ink = [p.x, p.y];
      inkD = smoothPath(ink);
      begin(e, { kind: 'ink' });
    } else {
      draft = { a: p, b: p };
      begin(e, { kind: 'draw' });
    }
  }

  function move(e: PointerEvent) {
    if (ed.pending && !drag) hover = point(e);
    if (!drag || e.pointerId !== drag.pointer) return;
    const p = point(e);
    const d = drag;
    if (d.kind === 'move') {
      const [dx, dy] = [p.x - d.from.x, p.y - d.from.y];
      if (!d.moved) {
        if (Math.hypot(dx, dy) * k < 3) return;
        d.moved = true;
        ed.checkpoint();
      }
      const s = d.start;
      if (s.kind === 'line') {
        const b = boundsOf(s);
        const c = clampBox({ ...b, x: b.x + dx, y: b.y + dy }, info.w, info.h);
        const [mx, my] = [c.x - b.x, c.y - b.y];
        ed.patch(d.o, { x1: s.x1 + mx, y1: s.y1 + my, x2: s.x2 + mx, y2: s.y2 + my });
        return;
      }
      let b: Box = clampBox({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }, info.w, info.h);
      // Alt turns snapping off for fine placement
      const snapped = e.altKey ? null : snapBox(b, d.xs, d.ys, 5 * px);
      if (snapped) b = { ...b, x: snapped.x, y: snapped.y };
      guides = { x: snapped?.gx ?? null, y: snapped?.gy ?? null };
      ed.patch(d.o, { x: b.x, y: b.y });
    } else if (d.kind === 'resize') {
      if (!d.moved) {
        d.moved = true;
        ed.checkpoint();
      }
      const s = d.start;
      if (s.kind === 'line') return;
      // pictures, marks and text keep their shape unless Shift is held; text always does
      const keep = s.kind === 'text' || (s.kind === 'image' || s.kind === 'mark') !== e.shiftKey;
      const b = resizeBox(s, d.handle, p.x - d.from.x, p.y - d.from.y, { keepAspect: keep, min: 4 });
      if (s.kind === 'text') {
        ed.patch(d.o, { size: Math.min(300, Math.max(4, (s.size * b.w) / s.w)) });
        const o = d.o as typeof s;
        ed.patch(o, { x: d.handle.includes('w') ? s.x + s.w - o.w : s.x, y: d.handle.includes('n') ? s.y + s.h - o.h : s.y });
      } else ed.patch(d.o, b);
    } else if (d.kind === 'end') {
      if (!d.moved) {
        d.moved = true;
        ed.checkpoint();
      }
      let q = onPage(p);
      const [ax, ay] = d.end === 1 ? [d.o.x2, d.o.y2] : [d.o.x1, d.o.y1];
      if (e.shiftKey) [q.x, q.y] = snapAngle(ax, ay, q.x, q.y);
      ed.patch(d.o, d.end === 1 ? { x1: q.x, y1: q.y } : { x2: q.x, y2: q.y });
    } else if (d.kind === 'draw' && draft) {
      const b = onPage(p);
      if (e.shiftKey && (ed.tool === 'line' || ed.tool === 'arrow')) [b.x, b.y] = snapAngle(draft.a.x, draft.a.y, b.x, b.y);
      draft = { a: draft.a, b };
    } else if (d.kind === 'ink') {
      // coalesced events keep fast strokes smooth
      const evs = e.getCoalescedEvents?.();
      for (const ev of evs?.length ? evs : [e]) {
        const q = onPage(point(ev));
        if (Math.hypot(q.x - ink[ink.length - 2], q.y - ink[ink.length - 1]) * k >= 1.5) ink.push(q.x, q.y);
      }
      inkD = smoothPath(ink);
    }
  }

  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    guides = { x: null, y: null };
    const cancelled = e.type === 'pointercancel';
    if (d.kind === 'tap') {
      const p = point(e);
      if (e.type !== 'pointerup' || Math.hypot(p.x - d.from.x, p.y - d.from.y) * k > 10) return;
      if (ed.pending) {
        ed.place(index, d.from, info);
        hover = null;
      } else {
        ed.create(ed.tool, index, d.from, info);
        done();
      }
      if (!ed.editing) void focusSelected();
    } else if (d.kind === 'draw' && draft) {
      if (!cancelled) {
        ed.createDragged(ed.tool, index, draft.a, draft.b, info);
        done();
        void focusSelected();
      }
      draft = null;
    } else if (d.kind === 'ink') {
      if (!cancelled) {
        ed.createInk(index, ink);
        ed.selected = null; // keep the page clear for the next stroke
      }
      ink = [];
      inkD = '';
    }
  }

  function dblclick(e: MouseEvent) {
    // with pointer capture the event can target the page instead of the object; pointerdown already selected it
    const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? ed.selected;
    if (id && ed.find(id)?.kind === 'text') ed.startEditing(id);
  }

  function key(e: KeyboardEvent, o: OverlayObject) {
    const dir = arrows[e.key];
    if (dir) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const [dx, dy] = [dir[0] * step, dir[1] * step];
      const id = `${o.id}:keys`;
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/⌘ + arrows resize
        if (o.kind === 'line') ed.update(o.id, { x2: o.x2 + dx, y2: o.y2 + dy }, id);
        else if (o.kind === 'text') ed.update(o.id, { size: Math.min(300, Math.max(4, o.size + (dx || -dy))) }, id);
        else ed.update(o.id, resizeBox(o, 'se', dx, dy, { keepAspect: o.kind === 'image' || o.kind === 'mark' }), id);
      } else if (o.kind === 'line') {
        ed.update(o.id, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }, id);
      } else {
        const b = clampBox({ x: o.x + dx, y: o.y + dy, w: o.w, h: o.h }, info.w, info.h);
        ed.update(o.id, { x: b.x, y: b.y }, id);
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      ed.remove(o.id);
      el?.focus({ preventScroll: true });
    } else if (e.key === 'Enter' && o.kind === 'text') {
      e.preventDefault();
      ed.startEditing(o.id);
    } else if (e.key === 'Escape') {
      ed.selected = null;
      (e.currentTarget as SVGElement).blur();
    }
  }

  function typingKey(e: KeyboardEvent) {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      e.stopPropagation();
      typing?.blur();
      void focusSelected();
    }
  }

  function handleSpots(o: OverlayObject): Handle[] {
    return o.kind === 'text' || o.kind === 'image' || o.kind === 'mark' ? cornerHandles : handles;
  }

  function spot(b: Box, h: Handle): Pt {
    return {
      x: h.includes('w') ? b.x : h.includes('e') ? b.x + b.w : b.x + b.w / 2,
      y: h.includes('n') ? b.y : h.includes('s') ? b.y + b.h : b.y + b.h / 2,
    };
  }

  const draftBox = $derived(draft && { x: Math.min(draft.a.x, draft.b.x), y: Math.min(draft.a.y, draft.b.y), w: Math.abs(draft.b.x - draft.a.x), h: Math.abs(draft.b.y - draft.a.y) });
  const ghost = $derived.by(() => {
    if (!ed.pending || !hover) return null;
    const { w, h } = fitInside(ed.pending.w, ed.pending.h, info.w * 0.9, info.h * 0.9);
    return { url: ed.assets.get(ed.pending.asset)?.url, ...clampBox({ x: hover.x - w / 2, y: hover.y - h / 2, w, h }, info.w, info.h) };
  });
</script>

{#snippet object(o: OverlayObject)}
  <g
    data-id={o.id}
    class="obj"
    tabindex="0"
    role="button"
    aria-label={describe(o)}
    aria-describedby={describedby}
    onfocus={() => (ed.selected = o.id)}
    onkeydown={(e) => key(e, o)}
  >
    {#if o.kind === 'text'}
      <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="transparent" />
      <text font-family={cssFonts[o.font]} font-size={o.size} font-weight={o.bold ? 700 : 400} fill={o.color}>
        {#each textLines(o.text) as line, i}<tspan x={o.x} y={o.y + baseline(i, o.size, o.font)}>{line}</tspan>{/each}
      </text>
    {:else if o.kind === 'image'}
      <image href={ed.assets.get(o.asset)?.url} x={o.x} y={o.y} width={o.w} height={o.h} preserveAspectRatio="none" opacity={o.opacity} />
    {:else if o.kind === 'rect'}
      <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill ?? 'none'} stroke={o.stroke ?? 'none'} stroke-width={o.strokeWidth} opacity={o.opacity} pointer-events="all" />
    {:else if o.kind === 'ellipse'}
      <ellipse cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} fill={o.fill ?? 'none'} stroke={o.stroke ?? 'none'} stroke-width={o.strokeWidth} opacity={o.opacity} pointer-events="all" />
    {:else if o.kind === 'highlight'}
      <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.color} opacity={HIGHLIGHT_OPACITY} />
    {:else if o.kind === 'mark'}
      {@const m = markPath(o)}
      <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="transparent" />
      <path d={m.d} fill="none" stroke={o.color} stroke-width={m.width} stroke-linecap="round" stroke-linejoin="round" />
    {:else if o.kind === 'line'}
      {@const l = linePaths(o)}
      <path d="M{o.x1} {o.y1}L{o.x2} {o.y2}" stroke="transparent" stroke-width={Math.max(o.width, 14 * px)} stroke-linecap="round" />
      <path d={l.line} fill="none" stroke={o.color} stroke-width={o.width} stroke-linecap="round" />
      {#if l.head}<path d={l.head} fill={o.color} />{/if}
    {:else if o.kind === 'ink'}
      {@const d = inkPath(o)}
      <path {d} fill="none" stroke="transparent" stroke-width={Math.max(o.width, 14 * px)} stroke-linecap="round" stroke-linejoin="round" />
      <path {d} fill="none" stroke={o.color} stroke-width={o.width} stroke-linecap="round" stroke-linejoin="round" />
    {/if}
  </g>
{/snippet}

<div
  bind:this={el}
  class="sheet"
  style:width="{info.w * k}px"
  style:height="{info.h * k}px"
  data-tool={ed.pending ? 'place' : ed.tool}
  role="group"
  aria-label="Page {index + 1}"
  tabindex="-1"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onlostpointercapture={up}
  onpointerleave={() => (hover = null)}
  ondblclick={dblclick}
>
  <div class="paper" class:ready={drawnAt > 0} bind:this={paper}></div>
  {#if failed}<p class="mono failed">This page couldn't be drawn, but you can still add to it.</p>{/if}

  {#if near}
    <svg class="layer hl" viewBox="0 0 {info.w} {info.h}" aria-hidden={mine.some((o) => o.kind === 'highlight') ? undefined : 'true'}>
      {#each mine.filter((o) => o.kind === 'highlight') as o (o.id)}{@render object(o)}{/each}
    </svg>
    <svg class="layer" viewBox="0 0 {info.w} {info.h}">
      {#each mine.filter((o) => o.kind !== 'highlight') as o (o.id)}{@render object(o)}{/each}
    </svg>

    <svg class="layer ui" viewBox="0 0 {info.w} {info.h}" aria-hidden="true">
      {#if guides.x !== null}<line class="guide" x1={guides.x} x2={guides.x} y1="0" y2={info.h} />{/if}
      {#if guides.y !== null}<line class="guide" y1={guides.y} y2={guides.y} x1="0" x2={info.w} />{/if}

      {#if sel}
        {#if sel.kind === 'line'}
          <line class="frame" x1={sel.x1} y1={sel.y1} x2={sel.x2} y2={sel.y2} />
          {#each [[sel.x1, sel.y1, 'p1'], [sel.x2, sel.y2, 'p2']] as const as [x, y, h] (h)}
            <g class="handle" data-handle={h} style:cursor="move">
              <circle cx={x} cy={y} r={14 * px} fill="transparent" />
              <circle class="knob" cx={x} cy={y} r={5 * px} />
            </g>
          {/each}
        {:else}
          {@const b = boundsOf(sel)}
          <rect class="frame" class:typing={!!editingObj} x={b.x - 2 * px} y={b.y - 2 * px} width={b.w + 4 * px} height={b.h + 4 * px} />
          {#if !editingObj}
            {#each handleSpots(sel) as h (h)}
              {@const p = spot(b, h)}
              <g class="handle {h}" data-handle={h}>
                <rect x={p.x - 13 * px} y={p.y - 13 * px} width={26 * px} height={26 * px} fill="transparent" />
                <rect class="knob" x={p.x - 5 * px} y={p.y - 5 * px} width={10 * px} height={10 * px} rx={2.5 * px} />
              </g>
            {/each}
          {/if}
        {/if}
      {/if}

      {#if draftBox}
        {@const t = ed.tool}
        {#if t === 'line' || t === 'arrow'}
          {@const l = linePaths({ x1: draft!.a.x, y1: draft!.a.y, x2: draft!.b.x, y2: draft!.b.y, width: ed.style.line.width, arrow: t === 'arrow' })}
          <path d={l.line} stroke={ed.style.line.color} stroke-width={ed.style.line.width} stroke-linecap="round" fill="none" />
          {#if l.head}<path d={l.head} fill={ed.style.line.color} />{/if}
        {:else if t === 'ellipse'}
          <ellipse cx={draftBox.x + draftBox.w / 2} cy={draftBox.y + draftBox.h / 2} rx={draftBox.w / 2} ry={draftBox.h / 2} fill={ed.style.shape.fill ?? 'none'} stroke={ed.style.shape.stroke ?? 'none'} stroke-width={ed.style.shape.strokeWidth} opacity={ed.style.shape.opacity} />
        {:else if t === 'highlight'}
          <rect x={draftBox.x} y={draftBox.y} width={draftBox.w} height={draftBox.h} fill={ed.style.highlight} opacity={HIGHLIGHT_OPACITY} />
        {:else if t === 'whiteout'}
          <rect class="whiteout-draft" x={draftBox.x} y={draftBox.y} width={draftBox.w} height={draftBox.h} />
        {:else}
          <rect x={draftBox.x} y={draftBox.y} width={draftBox.w} height={draftBox.h} fill={ed.style.shape.fill ?? 'none'} stroke={ed.style.shape.stroke ?? 'none'} stroke-width={ed.style.shape.strokeWidth} opacity={ed.style.shape.opacity} />
        {/if}
      {/if}
      {#if inkD}<path d={inkD} fill="none" stroke={ed.style.ink.color} stroke-width={ed.style.ink.width} stroke-linecap="round" stroke-linejoin="round" />{/if}
      {#if ghost?.url}<image class="ghost" href={ghost.url} x={ghost.x} y={ghost.y} width={ghost.w} height={ghost.h} preserveAspectRatio="none" />{/if}
    </svg>

    {#if editingObj}
      <textarea
        bind:this={typing}
        class="typing"
        style:left="{editingObj.x * k}px"
        style:top="{editingObj.y * k}px"
        style:width="{(editingObj.w + editingObj.size) * k}px"
        style:height="{editingObj.h * k}px"
        style:font-family={cssFonts[editingObj.font]}
        style:font-weight={editingObj.bold ? 700 : 400}
        style:font-size="{editingObj.size * k}px"
        value={editingObj.text}
        oninput={(e) => ed.patch(editingObj, { text: e.currentTarget.value })}
        onblur={() => ed.stopEditing()}
        onkeydown={typingKey}
        aria-label="Text on page {index + 1}. Escape to finish."
        wrap="off"
        autocomplete="off"
      ></textarea>
    {/if}
  {/if}
</div>

<style>
  .sheet {
    position: relative;
    isolation: isolate;
    margin-inline: auto;
    background: #fff;
    border-radius: 3px;
    box-shadow:
      0 1px 0 #0000001a,
      0 18px 40px -18px #000000cc;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: crosshair;
    outline: none;
    /* empty paper scrolls on touch; objects capture the drag (see the touchmove guard),
       and taps place things on release */
    &[data-tool='select'],
    &[data-tool='place'],
    &[data-tool='text'],
    &[data-tool='name'],
    &[data-tool='date'],
    &[data-tool='check'],
    &[data-tool='cross'] {
      touch-action: pan-x pan-y pinch-zoom;
    }
    &[data-tool='select'] {
      cursor: default;
    }
    &[data-tool='text'],
    &[data-tool='name'] {
      cursor: text;
    }
    &[data-tool='place'] {
      cursor: copy;
    }
  }
  .paper {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    background: linear-gradient(100deg, #fff 30%, #f1eee8 50%, #fff 70%) 0 0 / 300% 100%;
    animation: shimmer 1.4s linear infinite;
    &.ready {
      animation: none;
      background: #fff;
    }
    & :global(canvas) {
      display: block;
      width: 100%;
      height: 100%;
    }
  }
  @keyframes shimmer {
    to {
      background-position: -150% 0;
    }
  }
  .failed {
    position: absolute;
    inset: auto 0 45% 0;
    text-align: center;
    color: #8a8478;
  }
  .layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .hl {
    mix-blend-mode: multiply;
  }
  .obj {
    pointer-events: visiblePainted;
    outline: none;
    .sheet[data-tool='select'] & {
      cursor: move;
    }
  }
  text {
    white-space: pre;
    user-select: none;
  }
  .ui {
    & .frame {
      fill: none;
      stroke: var(--color-sun);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
      filter: drop-shadow(0 0 1px #0008);
      &.typing {
        stroke-dasharray: 4 3;
      }
    }
    & .guide {
      stroke: #ff3d8b;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    & .handle {
      pointer-events: all;
    }
    & .knob {
      fill: var(--color-sun);
      stroke: #131211;
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    & .whiteout-draft {
      fill: #fff;
      stroke: #9a948a;
      stroke-dasharray: 3 3;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    & .ghost {
      opacity: 0.55;
    }
  }
  .nw, .se { cursor: nwse-resize; }
  .ne, .sw { cursor: nesw-resize; }
  .n, .s { cursor: ns-resize; }
  .e, .w { cursor: ew-resize; }
  .typing {
    position: absolute;
    z-index: 1;
    margin: 0;
    padding: 0;
    border: 0;
    outline: none;
    resize: none;
    overflow: hidden;
    background: transparent;
    line-height: 1.2;
    white-space: pre;
    /* the svg underneath shows the text exactly as it will be saved; this only carries the caret */
    color: transparent;
    caret-color: #131211;
    &::selection {
      background: #ffd25e66;
    }
  }
</style>

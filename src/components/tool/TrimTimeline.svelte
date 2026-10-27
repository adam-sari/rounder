<script lang="ts">
  /*
   * Trim / cut timeline for video and audio tools.
   *
   *   <video bind:this={video} src={url}></video>
   *   <TrimTimeline {file} duration={info.durationSec} media={video} bind:start bind:end />
   *
   * Segments (cutter / ringtone / "remove the middle"):
   *   <TrimTimeline {file} {duration} media={audio} mode="segments" segmentKind="cut" bind:segments />
   *
   * Thumbnails (video) or a waveform (audio) load from `file` by themselves; pass `peaks` or
   * `thumbnails` to supply your own. Handles drag with mouse/touch and step with the arrow
   * keys (Shift = 1 s). Ctrl/⌘ + wheel zooms. The selection body drags as a whole.
   */
  import { onDestroy, untrack } from 'svelte';
  import Waveform from './Waveform.svelte';
  import { extractFrames, formatTime, parseTime, waveform, type Peaks, type Segment } from '@/engines/media';

  interface Props {
    duration: number;
    start?: number;
    end?: number;
    mode?: 'trim' | 'segments';
    segments?: Segment[];
    /** what segments mean: kept parts or removed parts */
    segmentKind?: 'keep' | 'cut';
    currentTime?: number;
    /** <video>/<audio> to keep in sync: playhead follows it, clicks and drags seek it */
    media?: HTMLMediaElement | null;
    file?: Blob | null;
    kind?: 'video' | 'audio';
    thumbnails?: ImageBitmap[];
    peaks?: Peaks | null;
    minLength?: number;
    /** arrow-key step in seconds (use 1 / fps for frame steps) */
    step?: number;
    /** keep playback inside the selection */
    loop?: boolean;
    disabled?: boolean;
    onchange?: (v: { start: number; end: number; segments: Segment[] }) => void;
  }

  let {
    duration,
    start = $bindable(0),
    end = $bindable(0),
    mode = 'trim',
    segments = $bindable([]),
    segmentKind = 'keep',
    currentTime = $bindable(0),
    media = null,
    file = null,
    kind,
    thumbnails,
    peaks,
    minLength = 0.1,
    step = 1 / 30,
    loop = false,
    disabled = false,
    onchange,
  }: Props = $props();

  const STRIP_H = 64;
  let track: HTMLDivElement;
  let viewport: HTMLDivElement;
  let stripCanvas: HTMLCanvasElement | undefined = $state();
  let trackWidth = $state(0);
  let viewportWidth = $state(0);
  let zoom = $state(1);
  let hoverX = $state<number | null>(null);
  let dragging = $state<string | null>(null);
  let selected = $state(0);
  let loadedThumbs = $state<ImageBitmap[]>([]);
  let loadedPeaks = $state<Peaks | null>(null);
  let loadError = $state('');
  let playing = $state(false);
  let stopAtEnd = false;

  const thumbs = $derived(thumbnails ?? loadedThumbs);
  const wave = $derived(peaks ?? loadedPeaks);
  const resolvedKind = $derived(kind ?? (file?.type.startsWith('audio/') ? 'audio' : 'video'));
  const maxZoom = $derived(Math.max(1, Math.min(60, duration / 2)));
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  // a fresh duration resets an unset or out-of-range end
  $effect(() => {
    if (duration > 0 && (!(end > 0) || end > duration)) end = duration;
    if (start > end) start = Math.max(0, end - minLength);
  });

  const emit = () => onchange?.({ start, end, segments });

  // ---------------------------------------------------------------- thumbnails & waveform

  let loadToken = 0;
  let abort: AbortController | null = null;
  // reloads only when the file (or kind) changes, not on resize/zoom
  $effect(() => {
    const f = file;
    const k = resolvedKind;
    if (!f || thumbnails || peaks) return;
    untrack(() => load(f, k));
  });

  function load(f: Blob, k: 'video' | 'audio') {
    const w = Math.max(trackWidth, 320);
    const token = ++loadToken;
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    loadError = '';
    if (k === 'audio') {
      waveform(f, Math.min(6000, Math.round(w * 4)), {}, { signal }).then(
        (p) => token === loadToken && (loadedPeaks = p),
        (e) => token === loadToken && e?.code !== 'aborted' && (loadError = 'Waveform unavailable'),
      );
    } else {
      const got: ImageBitmap[] = [];
      const count = clamp(Math.round(w / (STRIP_H * 1.4)), 4, 40);
      loadedThumbs.forEach((b) => b.close());
      loadedThumbs = [];
      const onFrame = (fr: { bitmap: ImageBitmap }) => {
        if (token !== loadToken) return fr.bitmap.close();
        got.push(fr.bitmap);
        loadedThumbs = [...got];
      };
      extractFrames(f, { count, height: Math.round(STRIP_H * (devicePixelRatio || 1)) }, { signal, onFrame }).catch((e) => {
        if (token !== loadToken || e?.code === 'aborted') return;
        // no picture track: show the sound instead
        if (e?.code === 'no-tracks') kind = 'audio';
        else loadError = 'Preview unavailable';
      });
    }
  }

  onDestroy(() => {
    abort?.abort();
    loadedThumbs.forEach((b) => b.close());
  });

  // thumbnails paint into one canvas: cheap to redraw on zoom/resize
  $effect(() => {
    const canvas = stripCanvas;
    const list = thumbs;
    const W = trackWidth;
    if (!canvas || !W) return;
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(STRIP_H * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!list.length) return;
    const n = Math.max(list.length, Math.round(W / (STRIP_H * 1.4)));
    const slot = canvas.width / n;
    for (let i = 0; i < n; i++) {
      const bmp = list[Math.min(list.length - 1, Math.floor((i / n) * list.length))];
      const s = Math.max(slot / bmp.width, canvas.height / bmp.height);
      const w = bmp.width * s;
      const h = bmp.height * s;
      ctx.save();
      ctx.beginPath();
      ctx.rect(i * slot, 0, slot, canvas.height);
      ctx.clip();
      ctx.drawImage(bmp, i * slot + (slot - w) / 2, (canvas.height - h) / 2, w, h);
      ctx.restore();
    }
  });

  // ---------------------------------------------------------------- media sync

  function seek(t: number, fast = false) {
    currentTime = clamp(t, 0, duration);
    if (!media) return;
    const m = media as HTMLMediaElement & { fastSeek?: (t: number) => void };
    if (fast && m.fastSeek) m.fastSeek(currentTime);
    else m.currentTime = currentTime;
  }

  $effect(() => {
    const m = media;
    if (!m) return;
    let raf = 0;
    const tick = () => {
      currentTime = m.currentTime;
      const [a, b] = activeRange();
      if (!m.paused && (loop || stopAtEnd) && currentTime >= b) {
        if (loop) m.currentTime = a;
        else {
          m.pause();
          stopAtEnd = false;
          m.currentTime = b;
        }
      }
      follow();
      if (!m.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      playing = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      playing = false;
      currentTime = m.currentTime;
    };
    const onSeeked = () => !dragging && (currentTime = m.currentTime);
    m.addEventListener('play', onPlay);
    m.addEventListener('pause', onPause);
    m.addEventListener('seeked', onSeeked);
    if (!m.paused) onPlay();
    return () => {
      cancelAnimationFrame(raf);
      m.removeEventListener('play', onPlay);
      m.removeEventListener('pause', onPause);
      m.removeEventListener('seeked', onSeeked);
    };
  });

  /** the range "play selection" and looping use */
  function activeRange(): [number, number] {
    if (mode === 'trim') return [start, end];
    const s = segments[selected];
    return s ? [s.start, s.end] : [0, duration];
  }

  function playSelection() {
    if (!media) return;
    if (!media.paused) return media.pause();
    const [a, b] = activeRange();
    if (currentTime < a || currentTime >= b - 0.05) media.currentTime = a;
    stopAtEnd = true;
    void media.play();
  }

  /** keep the playhead visible while zoomed in */
  function follow() {
    if (zoom <= 1 || dragging || !viewport) return;
    const x = (currentTime / duration) * trackWidth;
    if (x < viewport.scrollLeft || x > viewport.scrollLeft + viewportWidth - 24) viewport.scrollLeft = x - viewportWidth * 0.2;
  }

  // ---------------------------------------------------------------- pointer

  function timeAt(clientX: number) {
    const r = track.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * duration;
  }

  /** applies a drag/keyboard change to one handle, clamped against its neighbours */
  function setEdge(which: string, t: number) {
    if (which === 'start') start = clamp(t, 0, end - minLength);
    else if (which === 'end') end = clamp(t, start + minLength, duration);
    else {
      const [side, idx] = which.split(':');
      const i = Number(idx);
      const s = segments[i];
      const prev = segments[i - 1]?.end ?? 0;
      const next = segments[i + 1]?.start ?? duration;
      if (side === 's') s.start = clamp(t, prev, s.end - minLength);
      else s.end = clamp(t, s.start + minLength, next);
      segments = [...segments];
    }
  }

  function edgeValue(which: string) {
    if (which === 'start') return start;
    if (which === 'end') return end;
    const [side, idx] = which.split(':');
    const s = segments[Number(idx)];
    return side === 's' ? s.start : s.end;
  }

  let grabOffset = 0;
  let moveFrom: { a: number; b: number } | null = null;

  function down(e: PointerEvent, which: string) {
    if (disabled || e.button > 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = which;
    const t = timeAt(e.clientX);
    if (which === 'move') {
      const [a, b] = mode === 'trim' ? [start, end] : [segments[selected].start, segments[selected].end];
      moveFrom = { a, b };
      grabOffset = t;
    } else if (which !== 'seek') {
      grabOffset = t - edgeValue(which);
      if (which.includes(':')) selected = Number(which.split(':')[1]);
    } else {
      seek(t, true);
    }
  }

  function move(e: PointerEvent) {
    if (!dragging) return;
    const t = timeAt(e.clientX);
    if (dragging === 'seek') return seek(t, true);
    if (dragging === 'move' && moveFrom) {
      const len = moveFrom.b - moveFrom.a;
      let lo = 0;
      let hi = duration;
      if (mode === 'segments') {
        lo = segments[selected - 1]?.end ?? 0;
        hi = segments[selected + 1]?.start ?? duration;
      }
      const a = clamp(moveFrom.a + (t - grabOffset), lo, hi - len);
      if (mode === 'trim') {
        start = a;
        end = a + len;
      } else {
        segments[selected] = { start: a, end: a + len };
        segments = [...segments];
      }
      return seek(a, true);
    }
    setEdge(dragging, t - grabOffset);
    seek(edgeValue(dragging), true);
  }

  function up() {
    if (!dragging) return;
    const was = dragging;
    dragging = null;
    moveFrom = null;
    if (was !== 'seek') {
      seek(edgeValue(was === 'move' ? (mode === 'trim' ? 'start' : `s:${selected}`) : was));
      emit();
    } else if (media) media.currentTime = currentTime;
  }

  function key(e: KeyboardEvent, which: string) {
    if (disabled) return;
    const big = 1;
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };
    let t: number | null = null;
    if (e.key in deltas) t = edgeValue(which) + deltas[e.key] * (e.shiftKey ? big : step);
    else if (e.key === 'Home') t = 0;
    else if (e.key === 'End') t = duration;
    if (t === null) return;
    e.preventDefault();
    setEdge(which, t);
    seek(edgeValue(which));
    emit();
  }

  function wheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || maxZoom <= 1) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    const anchor = (e.clientX - r.left + viewport.scrollLeft) / trackWidth;
    setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8), anchor, e.clientX - r.left);
  }

  function setZoom(z: number, anchor = currentTime / duration, screenX = viewportWidth / 2) {
    zoom = clamp(z, 1, maxZoom);
    // after layout, put the anchor back under the cursor (or the playhead in the middle)
    requestAnimationFrame(() => viewport && (viewport.scrollLeft = anchor * trackWidth - screenX));
  }

  // ---------------------------------------------------------------- segments & inputs

  function addSegment() {
    const len = Math.min(Math.max(minLength, duration * 0.1), 5);
    const gaps: Segment[] = [];
    let cursor = 0;
    for (const s of segments) {
      if (s.start - cursor >= minLength) gaps.push({ start: cursor, end: s.start });
      cursor = s.end;
    }
    if (duration - cursor >= minLength) gaps.push({ start: cursor, end: duration });
    const gap = gaps.find((g) => currentTime >= g.start && currentTime < g.end) ?? gaps.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (!gap) return;
    const a = clamp(currentTime, gap.start, Math.max(gap.start, gap.end - len));
    const seg = { start: a, end: Math.min(gap.end, a + len) };
    // find the index before assigning: the bound array becomes a proxy, so `seg` is no longer in it by identity
    const next = [...segments, seg].sort((x, y) => x.start - y.start);
    selected = next.indexOf(seg);
    segments = next;
    emit();
  }

  function removeSegment() {
    if (!segments.length) return;
    segments = segments.filter((_, i) => i !== selected);
    selected = Math.max(0, selected - 1);
    emit();
  }

  function setFromPlayhead(which: 'start' | 'end') {
    setEdge(mode === 'trim' ? which : `${which === 'start' ? 's' : 'e'}:${selected}`, currentTime);
    emit();
  }

  function commitInput(e: Event, which: 'start' | 'end') {
    const input = e.currentTarget as HTMLInputElement;
    const t = parseTime(input.value);
    if (t === null) {
      input.value = formatTime(which === 'start' ? sel[0] : sel[1]);
      return;
    }
    setEdge(mode === 'trim' ? which : `${which === 'start' ? 's' : 'e'}:${selected}`, t);
    input.value = formatTime(which === 'start' ? sel[0] : sel[1]);
    seek(which === 'start' ? sel[0] : sel[1]);
    emit();
  }

  const sel = $derived<[number, number]>(mode === 'trim' ? [start, end] : segments[selected] ? [segments[selected].start, segments[selected].end] : [0, 0]);
  const kept = $derived(
    mode === 'trim' ? end - start : segmentKind === 'keep' ? segments.reduce((s, x) => s + x.end - x.start, 0) : duration - segments.reduce((s, x) => s + x.end - x.start, 0),
  );

  /** ruler spacing: the first "nice" interval whose labels don't collide (sub-second labels are wider) */
  const ticks = $derived.by(() => {
    if (!duration || !trackWidth) return [];
    const pxPerSec = trackWidth / duration;
    const every = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find((s) => s * pxPerSec >= (s < 1 ? 96 : 72)) ?? 3600;
    const out: { t: number; label: string }[] = [];
    for (let t = 0; t <= duration + 1e-6; t += every) out.push({ t, label: formatTime(t, every < 1 ? 2 : 0) });
    return out;
  });
</script>

<div class="timeline" class:disabled>
  <div class="bar">
    <div class="times">
      <label class="time">
        <span class="mono">{mode === 'trim' ? 'start' : 'from'}</span>
        <input class="mono" value={formatTime(sel[0])} onchange={(e) => commitInput(e, 'start')} disabled={disabled || (mode === 'segments' && !segments.length)} aria-label="Start time" />
      </label>
      <label class="time">
        <span class="mono">{mode === 'trim' ? 'end' : 'to'}</span>
        <input class="mono" value={formatTime(sel[1])} onchange={(e) => commitInput(e, 'end')} disabled={disabled || (mode === 'segments' && !segments.length)} aria-label="End time" />
      </label>
      <span class="length mono">
        {mode === 'trim' ? 'length' : segmentKind === 'keep' ? 'kept' : 'left after cuts'}
        <b>{formatTime(Math.max(0, kept))}</b>
      </span>
    </div>
    <div class="tools">
      {#if media}
        <button type="button" class="chip" onclick={playSelection} disabled={disabled} aria-label={playing ? 'Pause' : 'Play selection'}>
          {playing ? '❚❚' : '▶'} <span>{playing ? 'pause' : 'play selection'}</span>
        </button>
      {/if}
      <button type="button" class="chip" onclick={() => setFromPlayhead('start')} disabled={disabled || (mode === 'segments' && !segments.length)} title="Set start at playhead">[ <span>in</span></button>
      <button type="button" class="chip" onclick={() => setFromPlayhead('end')} disabled={disabled || (mode === 'segments' && !segments.length)} title="Set end at playhead"><span>out</span> ]</button>
      {#if mode === 'segments'}
        <button type="button" class="chip" onclick={addSegment} {disabled}>+ <span>segment</span></button>
        <button type="button" class="chip" onclick={removeSegment} disabled={disabled || !segments.length}>× <span>remove</span></button>
      {/if}
      {#if maxZoom > 1}
        <span class="zoom">
          <button type="button" class="chip" onclick={() => setZoom(zoom / 1.6)} disabled={zoom <= 1} aria-label="Zoom out">−</button>
          <button type="button" class="chip" onclick={() => setZoom(zoom * 1.6)} disabled={zoom >= maxZoom} aria-label="Zoom in">+</button>
        </span>
      {/if}
    </div>
  </div>

  <div class="viewport" class:zoomed={zoom > 1} bind:this={viewport} bind:clientWidth={viewportWidth} onwheel={wheel}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="track"
      bind:this={track}
      bind:clientWidth={trackWidth}
      style:width={`${zoom * 100}%`}
      onpointerdown={(e) => down(e, 'seek')}
      onpointermove={(e) => {
        hoverX = e.clientX - track.getBoundingClientRect().left;
        move(e);
      }}
      onpointerleave={() => (hoverX = null)}
      onpointerup={up}
      onpointercancel={up}
    >
      <div class="strip">
        {#if resolvedKind === 'audio' || (wave && !thumbs.length)}
          <Waveform peaks={wave} progress={currentTime / (duration || 1)} />
        {:else}
          <canvas bind:this={stripCanvas} aria-hidden="true"></canvas>
        {/if}
        {#if !thumbs.length && !wave}
          <div class="placeholder mono">{loadError || (file ? 'loading preview…' : '')}</div>
        {/if}
      </div>

      {#if mode === 'trim'}
        <div class="shade l" style:width={`${pct(start)}%`}></div>
        <div class="shade r" style:left={`${pct(end)}%`}></div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="sel" class:active={dragging === 'move'} style:left={`${pct(start)}%`} style:width={`${pct(end - start)}%`} onpointerdown={(e) => down(e, 'move')}>
          <button
            type="button"
            class="handle start"
            class:active={dragging === 'start'}
            role="slider"
            aria-label="Trim start"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={start}
            aria-valuetext={formatTime(start)}
            onpointerdown={(e) => down(e, 'start')}
            onkeydown={(e) => key(e, 'start')}
            {disabled}><i></i></button
          >
          <button
            type="button"
            class="handle end"
            class:active={dragging === 'end'}
            role="slider"
            aria-label="Trim end"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={end}
            aria-valuetext={formatTime(end)}
            onpointerdown={(e) => down(e, 'end')}
            onkeydown={(e) => key(e, 'end')}
            {disabled}><i></i></button
          >
        </div>
      {:else}
        {#each segments as s, i (i)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="sel seg"
            class:cut={segmentKind === 'cut'}
            class:picked={i === selected}
            style:left={`${pct(s.start)}%`}
            style:width={`${pct(s.end - s.start)}%`}
            onpointerdown={(e) => {
              selected = i;
              down(e, 'move');
            }}
          >
            <span class="tag mono">{i + 1}</span>
            <button
              type="button"
              class="handle start"
              role="slider"
              aria-label={`Segment ${i + 1} start`}
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={s.start}
              aria-valuetext={formatTime(s.start)}
              onpointerdown={(e) => down(e, `s:${i}`)}
              onkeydown={(e) => key(e, `s:${i}`)}
              onfocus={() => (selected = i)}
              {disabled}><i></i></button
            >
            <button
              type="button"
              class="handle end"
              role="slider"
              aria-label={`Segment ${i + 1} end`}
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={s.end}
              aria-valuetext={formatTime(s.end)}
              onpointerdown={(e) => down(e, `e:${i}`)}
              onkeydown={(e) => key(e, `e:${i}`)}
              onfocus={() => (selected = i)}
              {disabled}><i></i></button
            >
          </div>
        {/each}
      {/if}

      {#if hoverX !== null && !dragging}
        <div class="ghost" style:left={`${hoverX}px`}><span class="mono">{formatTime((hoverX / (trackWidth || 1)) * duration)}</span></div>
      {/if}
      <div class="playhead" class:live={playing} style:left={`${pct(currentTime)}%`}><span></span></div>
    </div>
    <div class="ruler" style:width={`${zoom * 100}%`} aria-hidden="true">
      {#each ticks as tick, i (tick.t)}
        <span class="mono" class:last={i > 0 && i === ticks.length - 1 && tick.t > duration - 1e-6 - (ticks[1]?.t ?? 0) / 2} style:left={`${pct(tick.t)}%`}>{tick.label}</span>
      {/each}
    </div>
  </div>
</div>

<style>
  .timeline {
    --h: 64px;
    --grip: 14px;
    display: grid;
    gap: 10px;
    user-select: none;
    -webkit-user-select: none;
  }
  .disabled {
    opacity: 0.55;
    pointer-events: none;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .times,
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .time {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 10px;
    border: 1px solid var(--color-line-2);
    border-radius: 10px;
    background: #141312;
    & input {
      /* "00:00.00" plus room for hours ("1:02:03.00") */
      width: 10.5ch;
      border: 0;
      background: transparent;
      color: var(--color-chalk);
      font-size: 13px;
      padding: 4px 6px;
      border-radius: 6px;
      &:focus {
        outline: none;
        background: #ffd25e1a;
        color: var(--color-sun);
      }
    }
    &:focus-within {
      border-color: var(--color-sun);
    }
  }
  .length {
    padding-left: 4px;
    & b {
      font-weight: 500;
      color: var(--color-chalk);
      margin-left: 4px;
    }
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: 400 12.5px var(--font-mono);
    color: var(--color-soft);
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    border-radius: 9px;
    padding: 6px 10px;
    cursor: pointer;
    transition:
      transform 0.18s var(--ease-spring),
      border-color 0.15s,
      color 0.15s;
    &:hover:not(:disabled) {
      border-color: var(--color-muted);
      color: var(--color-chalk);
    }
    &:active:not(:disabled) {
      transform: scale(0.95);
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  .zoom {
    display: inline-flex;
    gap: 4px;
  }
  @media (max-width: 560px) {
    .chip span {
      display: none;
    }
  }

  .viewport {
    overflow: hidden;
    &.zoomed {
      overflow-x: auto;
    }
    /* room for the playhead knob and handle overhang, which overflow clipping would cut */
    padding: 10px calc(var(--grip) + 2px) 2px;
    scrollbar-width: thin;
    scrollbar-color: var(--color-line-2) transparent;
  }
  .track {
    position: relative;
    height: var(--h);
    border-radius: 12px;
    background: var(--color-panel-2);
    outline: 1px solid var(--color-line-2);
    cursor: pointer;
    touch-action: none;
  }
  .strip {
    position: absolute;
    inset: 0;
    border-radius: 12px;
    overflow: hidden;
    & canvas {
      width: 100%;
      height: 100%;
      display: block;
    }
  }
  .placeholder {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: repeating-linear-gradient(-45deg, transparent 0 10px, #f2ede408 10px 11px);
  }
  .shade {
    position: absolute;
    top: 0;
    bottom: 0;
    background: #131211c4;
    pointer-events: none;
    &.l {
      left: 0;
      border-radius: 12px 0 0 12px;
    }
    &.r {
      right: 0;
      border-radius: 0 12px 12px 0;
    }
  }

  .sel {
    position: absolute;
    top: -3px;
    bottom: -3px;
    border-top: 3px solid var(--color-sun);
    border-bottom: 3px solid var(--color-sun);
    box-shadow: 0 0 0 1px #00000040, 0 6px 24px -8px #ffd25e66;
    cursor: grab;
    transition: box-shadow 0.2s;
    &.active {
      cursor: grabbing;
      box-shadow: 0 0 0 1px #00000040, 0 8px 30px -6px #ffd25e99;
    }
  }
  .seg {
    background: #ffd25e1f;
    opacity: 0.8;
    &.picked {
      opacity: 1;
      z-index: 1;
    }
    &.cut {
      --cut: var(--color-bad);
      border-color: var(--cut);
      background: repeating-linear-gradient(-45deg, #ff7a6b33 0 6px, #ff7a6b14 6px 12px);
      box-shadow: none;
      & .handle {
        background: var(--cut);
      }
    }
  }
  .tag {
    position: absolute;
    top: 3px;
    left: 6px;
    font-size: 11px;
    color: var(--color-bg);
    background: var(--color-sun);
    border-radius: 5px;
    padding: 0 5px;
    pointer-events: none;
  }
  .cut .tag {
    background: var(--color-bad);
  }

  .handle {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: var(--grip);
    padding: 0;
    border: 0;
    background: var(--color-sun);
    cursor: ew-resize;
    touch-action: none;
    display: grid;
    place-items: center;
    transition: transform 0.2s var(--ease-spring);
    /* a wider invisible hit area for fingers */
    &::before {
      content: '';
      position: absolute;
      inset: -6px -10px;
    }
    & i {
      width: 2px;
      height: 18px;
      border-radius: 2px;
      background: #13121199;
      box-shadow: 4px 0 0 #13121166;
      translate: -2px 0;
    }
    &.start {
      left: calc(-1 * var(--grip));
      border-radius: 9px 0 0 9px;
    }
    &.end {
      right: calc(-1 * var(--grip));
      border-radius: 0 9px 9px 0;
    }
    &:hover,
    &.active {
      transform: scaleX(1.12);
    }
    &:focus-visible {
      outline: 2px solid var(--color-chalk);
      outline-offset: 1px;
      z-index: 2;
    }
  }

  .playhead {
    position: absolute;
    top: -8px;
    bottom: -4px;
    width: 2px;
    margin-left: -1px;
    background: var(--color-chalk);
    box-shadow: 0 0 0 1px #13121180;
    pointer-events: none;
    z-index: 3;
    & span {
      position: absolute;
      top: 0;
      left: 50%;
      width: 12px;
      height: 12px;
      translate: -50% -2px;
      border-radius: 3px 3px 7px 7px;
      background: var(--color-chalk);
    }
  }
  .ghost {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: #f2ede466;
    pointer-events: none;
    z-index: 2;
    & span {
      position: absolute;
      top: 4px;
      left: 6px;
      padding: 2px 6px;
      border-radius: 6px;
      background: var(--color-bg);
      border: 1px solid var(--color-line-2);
      color: var(--color-chalk);
      font-size: 11px;
      white-space: nowrap;
    }
  }
  .ruler {
    position: relative;
    height: 18px;
    margin-top: 6px;
    & span {
      position: absolute;
      translate: -50% 0;
      font-size: 10.5px;
      white-space: nowrap;
      &::before {
        content: '';
        position: absolute;
        left: 50%;
        top: -5px;
        width: 1px;
        height: 4px;
        background: var(--color-line-2);
      }
    }
    & span:first-child {
      translate: 0 0;
      &::before {
        left: 0;
      }
    }
    /* the last label hangs inside the track instead of overflowing it */
    & span.last {
      translate: -100% 0;
      &::before {
        left: 100%;
      }
    }
  }
</style>

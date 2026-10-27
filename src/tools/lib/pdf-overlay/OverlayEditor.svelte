<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { loadEditablePdf, missingGlyphs, pdfName, runQpdf, type PdfDoc } from '@/engines/pdf';
  import { downloadBlob, formatBytes } from '@/tools/lib/files';
  import { drawOverlays, isBlank } from './draw';
  import { assetFromBlob, clickTools, dragTools, Editor, imageFileAsset, type Sig, type Style, type Tool } from './editor.svelte';
  import { fitInside } from './geometry';
  import { toolIcons, toolLabels } from './icons';
  import { dateFormats, fontLabels, formatDate, highlightColors, swatches, type DateFormat, type OverlayObject, type PageInfo } from './model';
  import OverlayPage from './OverlayPage.svelte';
  import { loadName, loadSaved, storeName, storeSaved, withSaved, type SigRole } from './saved';
  import SignatureMaker, { type MadeSignature } from './SignatureMaker.svelte';

  interface Props {
    file: File;
    doc: PdfDoc;
    /** what opened it, if encrypted: the saved copy is locked with it again */
    password?: string;
    tools: Tool[];
    /** added to the file name: "-signed" → contract-signed.pdf */
    suffix: string;
    saveLabel: string;
    /** choose another file */
    onreset: () => void;
    /** a short honest note shown by the download button */
    note?: Snippet;
  }

  let { file, doc, password, tools, suffix, saveLabel, onreset, note }: Props = $props();

  const ed = new Editor();
  const GAP = 30;
  const TOP = 30;
  const zooms = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  const widths = [1, 2, 4];
  const id = $props.id();

  let pages = $state.raw<PageInfo[]>([]);
  let loadError = $state('');
  let scroller = $state<HTMLDivElement>();
  let viewW = $state(0);
  let viewH = $state(0);
  let scrollY = $state(0);
  let zoom = $state(1);
  let maker = $state<SigRole | null>(null);
  let imageInput = $state<HTMLInputElement>();
  let busy = $state('');
  let notice = $state('');
  let saving = $state(false);
  let error = $state('');
  let warning = $state('');
  let result = $state<{ name: string; size: string } | null>(null);

  const maxW = $derived(pages.length ? Math.max(...pages.map((p) => p.w)) : 612);
  // fit the widest page, but don't blow small pages up beyond a comfortable size
  const fit = $derived(Math.min(1.3, Math.max(0.15, (viewW - 32) / maxW)));
  const k = $derived(fit * zoom);
  const tops = $derived.by(() => {
    let y = TOP;
    return pages.map((p) => {
      const t = y;
      y += p.h * k + GAP;
      return t;
    });
  });
  const current = $derived.by(() => {
    const mark = scrollY + viewH * 0.4;
    let i = 0;
    while (i < tops.length - 1 && tops[i + 1] <= mark) i++;
    return i;
  });
  const cur = $derived(ed.current);
  const live = $derived(ed.objects.filter((o) => !isBlank(o)).length);

  const isNear = (i: number) => tops[i] < scrollY + viewH + 1500 && tops[i] + pages[i].h * k > scrollY - 1500;

  onMount(() => {
    let alive = true;
    (async () => {
      const out: PageInfo[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        out.push({ w: vp.width, h: vp.height, view: [...page.view], rotate: page.rotate });
        if (!alive) return;
        // show the first pages straight away on long documents
        if (i === 0 || i % 20 === 19 || i === doc.numPages - 1) pages = out.slice();
      }
    })().catch((e) => (loadError = (e as Error)?.message || "This PDF's pages couldn't be read."));

    ed.name = loadName();
    void (async () => {
      for (const s of loadSaved()) {
        try {
          const blob = await (await fetch(s.data)).blob();
          const bmp = await createImageBitmap(blob);
          const { width, height } = bmp;
          bmp.close();
          const a = await assetFromBlob(blob, 'png', width, height);
          // the editor may be gone by now, its other object URLs already revoked
          if (!alive) return URL.revokeObjectURL(a.url);
          const asset = ed.addAsset(a);
          ed.sigs.push({ id: s.id, role: s.role, asset, saved: true });
        } catch {
          // a damaged saved signature is skipped
        }
      }
    })();

    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      void setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    scroller?.addEventListener('wheel', wheel, { passive: false });
    return () => {
      alive = false;
      scroller?.removeEventListener('wheel', wheel);
      ed.destroy();
    };
  });

  // unsaved work: ask before the tab closes
  $effect(() => {
    if (!ed.dirty || !live) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });

  function leave() {
    if (ed.dirty && live && !confirm("Open another PDF? Changes you haven't downloaded will be lost.")) return;
    onreset();
  }

  async function setZoom(z: number) {
    const next = Math.min(4, Math.max(0.25, z));
    if (!scroller || next === zoom) return;
    const ratio = next / zoom;
    const [ax, ay] = [scroller.scrollLeft + viewW / 2, scroller.scrollTop + viewH / 2];
    // the spot in the middle of the view, as a page and a distance into it (the gaps between pages don't scale)
    let i = 0;
    while (i < tops.length - 1 && tops[i + 1] <= ay) i++;
    const into = tops.length ? (ay - tops[i]) / k : 0;
    zoom = next;
    await tick();
    scroller.scrollTop = (tops[i] ?? TOP) + into * k - viewH / 2;
    scroller.scrollLeft = ax * ratio - viewW / 2;
  }

  const stepZoom = (dir: 1 | -1) => setZoom(dir > 0 ? (zooms.find((z) => z > zoom + 0.01) ?? 4) : ([...zooms].reverse().find((z) => z < zoom - 0.01) ?? 0.25));

  /** the middle of the visible part of the current page */
  function inView() {
    const i = Math.min(current, pages.length - 1);
    const info = pages[i];
    const y = Math.min(Math.max((scrollY + viewH / 2 - tops[i]) / k, 30), info.h - 30);
    return { i, info, p: { x: info.w / 2, y } };
  }

  /** shape tools a keyboard can use too: they get their default size */
  const keyDrawable = (t: Tool) => dragTools.includes(t) && t !== 'ink';

  function placeInView() {
    if (!pages.length) return;
    const { i, info, p } = inView();
    if (ed.pending) ed.place(i, p, info);
    else if (clickTools.includes(ed.tool)) {
      ed.create(ed.tool, i, { ...p, x: info.w * 0.3 }, info);
      ed.tool = 'select';
    } else if (keyDrawable(ed.tool)) {
      ed.createDragged(ed.tool, i, p, p, info);
      if (ed.tool !== 'highlight') ed.tool = 'select';
    }
    if (!ed.editing) void focusSelected();
  }

  async function focusSelected() {
    await tick();
    scroller?.querySelector<SVGElement>(`[data-id="${ed.selected}"]`)?.focus({ preventScroll: true });
  }

  function pick(t: Tool) {
    if (ed.editing) ed.stopEditing();
    ed.pending = null;
    ed.selected = null;
    notice = '';
    if (t === 'image') {
      imageInput?.click();
      return;
    }
    ed.tool = t;
    if ((t === 'signature' || t === 'initials') && !ed.sigs.some((s) => s.role === t)) maker = t;
  }

  function useSig(s: Sig) {
    const a = ed.assets.get(s.asset);
    if (!a) return;
    const [maxW, maxH] = s.role === 'initials' ? [60, 36] : [160, 56];
    ed.pending = { asset: s.asset, role: s.role, ...fitInside(a.width, a.height, maxW, maxH) };
    // small images still get a sensible size
    if (ed.pending.w < maxW && ed.pending.h < maxH) Object.assign(ed.pending, fitInside(a.width * 100, a.height * 100, maxW, maxH));
    ed.tool = s.role;
  }

  function forget(s: Sig) {
    const rest = loadSaved().filter((x) => x.id !== s.id);
    storeSaved(rest);
    // the name was only remembered alongside a signature
    if (!rest.length) storeName('');
    ed.sigs = ed.sigs.filter((x) => x !== s);
  }

  const toDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });

  async function made(role: SigRole, m: MadeSignature) {
    maker = null;
    const asset = ed.addAsset(await assetFromBlob(m.blob, 'png', m.width, m.height));
    const sig: Sig = { id: `sig-${Date.now().toString(36)}`, role, asset, saved: false };
    if (m.remember) {
      sig.saved = storeSaved(withSaved(loadSaved(), { id: sig.id, role, data: await toDataUrl(m.blob) }));
      if (!sig.saved) notice = "Your browser wouldn't let us remember it (private mode or full storage), but you can use it on this document.";
    }
    if (m.name) {
      ed.name = m.name;
      if (m.remember) storeName(m.name);
    }
    ed.sigs = [sig, ...ed.sigs];
    useSig(sig);
  }

  async function addImage(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    busy = `Preparing ${f.name}…`;
    error = '';
    try {
      const a = await imageFileAsset(f);
      // about 96 dpi to start with, never bigger than a good chunk of the page
      ed.pending = { asset: ed.addAsset(a), ...fitInside(a.width * 0.75, a.height * 0.75, 240, 240) };
      ed.tool = 'image';
    } catch (e) {
      error = (e as Error)?.message || "This image couldn't be opened. Try a PNG or JPG.";
    } finally {
      busy = '';
    }
  }

  /* ---------- properties: change the selection, and remember as the default for new ones ---------- */

  function setText(p: Partial<Style['text']>) {
    if (cur?.kind === 'text') ed.update(cur.id, p);
    Object.assign(ed.style.text, p);
  }
  function setShape(p: Partial<Style['shape']>) {
    if (cur?.kind === 'rect' || cur?.kind === 'ellipse') {
      // a box needs a fill or a border, or it would vanish
      const next = { fill: cur.fill, stroke: cur.stroke, ...p };
      if (!next.fill && !next.stroke) return;
      ed.update(cur.id, p);
    } else if (!({ ...ed.style.shape, ...p }.fill || { ...ed.style.shape, ...p }.stroke)) return;
    Object.assign(ed.style.shape, p);
  }
  function setLine(p: { color?: string; width?: number; arrow?: boolean }) {
    if (cur?.kind === 'line') ed.update(cur.id, p);
    const { arrow, ...rest } = p;
    Object.assign(ed.style.line, rest);
    if (arrow !== undefined && cur?.kind !== 'line') ed.tool = arrow ? 'arrow' : 'line';
  }
  function setInk(p: Partial<Style['ink']>) {
    if (cur?.kind === 'ink') ed.update(cur.id, p);
    Object.assign(ed.style.ink, p);
  }
  function setMark(color: string) {
    if (cur?.kind === 'mark') ed.update(cur.id, { color });
    ed.style.mark.color = color;
  }
  function setHighlight(color: string) {
    if (cur?.kind === 'highlight') ed.update(cur.id, { color });
    ed.style.highlight = color;
  }

  const textStyle = $derived(cur?.kind === 'text' ? cur : ed.style.text);
  const shapeStyle = $derived(cur?.kind === 'rect' || cur?.kind === 'ellipse' ? cur : ed.style.shape);
  const lineStyle = $derived(cur?.kind === 'line' ? cur : { ...ed.style.line, arrow: ed.tool === 'arrow' });
  const inkStyle = $derived(cur?.kind === 'ink' ? cur : ed.style.ink);

  type Panel = 'text' | 'image' | 'shape' | 'highlight' | 'mark' | 'line' | 'ink' | 'sig' | 'whiteout' | 'place' | 'none';
  const panel = $derived.by((): Panel => {
    if (ed.pending) return 'place';
    if (cur) {
      if (cur.kind === 'rect' && cur.fill === '#ffffff' && !cur.stroke) return 'whiteout';
      return cur.kind === 'rect' || cur.kind === 'ellipse' ? 'shape' : cur.kind;
    }
    const t = ed.tool;
    if (t === 'text' || t === 'name' || t === 'date') return 'text';
    if (t === 'rect' || t === 'ellipse') return 'shape';
    if (t === 'check' || t === 'cross') return 'mark';
    if (t === 'line' || t === 'arrow') return 'line';
    if (t === 'signature' || t === 'initials') return 'sig';
    if (t === 'highlight' || t === 'ink' || t === 'whiteout') return t;
    return 'none';
  });

  const toolHint: Partial<Record<Tool, string>> = {
    text: 'Click on a page to start typing.',
    name: 'Click on a page to add your name.',
    date: 'Click on a page to add the date.',
    check: 'Click on a page to add a check mark.',
    cross: 'Click on a page to add a cross.',
    rect: 'Drag on a page to draw a box.',
    ellipse: 'Drag on a page to draw a circle or oval.',
    whiteout: 'Drag over anything you want to cover. Then add text on top to replace it.',
    highlight: 'Drag across the text you want to highlight.',
    line: 'Drag to draw a line. Hold Shift for straight angles.',
    arrow: 'Drag to draw an arrow. Hold Shift for straight angles.',
    ink: 'Draw freehand with your mouse, finger or stylus.',
  };

  /* ---------- keyboard ---------- */

  function keys(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) ed.redo();
      else ed.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      ed.redo();
    } else if (mod && key === 'd' && ed.selected) {
      e.preventDefault();
      ed.duplicate(ed.selected);
      void focusSelected();
    } else if (e.key === 'Escape') {
      ed.pending = null;
      ed.tool = 'select';
    }
  }

  /* ---------- save ---------- */

  async function save() {
    if (ed.editing) ed.stopEditing();
    saving = true;
    error = '';
    warning = '';
    result = null;
    try {
      const objects = $state.snapshot(ed.objects).filter((o) => !isBlank(o)) as OverlayObject[];
      const text = objects.flatMap((o) => (o.kind === 'text' ? [o.text] : [])).join('\n');
      const missing = await missingGlyphs(text).catch(() => []);
      const { doc: pdf } = await loadEditablePdf(file, { password });
      await drawOverlays(pdf, pages, objects, ed.assets);
      let bytes = await pdf.save();
      // it was locked when it came in, so lock the copy with the same password
      if (password) bytes = await runQpdf(['--encrypt', `--user-password=${password}`, `--owner-password=${password}`, '--bits=256', '--', 'in.pdf', 'out.pdf'], bytes);
      const name = pdfName(file.name, suffix);
      downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name);
      result = { name, size: formatBytes(bytes.length) };
      ed.dirty = false;
      if (missing.length) warning = `These characters aren't in the built-in fonts and show as empty boxes: ${missing.slice(0, 12).join(' ')}`;
    } catch (e) {
      console.error(e);
      error = (e as Error)?.message || 'Something went wrong while saving the PDF.';
    } finally {
      saving = false;
    }
  }
</script>

{#snippet colors(list: readonly string[], value: string | null, set: (c: string | null) => void, label: string, none = false)}
  <div class="swatches" role="group" aria-label={label}>
    {#if none}
      <button type="button" class="sw none" aria-pressed={value === null} aria-label="None" title="None" onclick={() => set(null)}></button>
    {/if}
    {#each list as c (c)}
      <button type="button" class="sw" style:--c={c} aria-pressed={value === c} aria-label={c} title={c} onclick={() => set(c)}></button>
    {/each}
    <label class="sw custom" title="Custom color">
      <input type="color" value={value ?? '#000000'} aria-label="{label}: custom" oninput={(e) => set(e.currentTarget.value)} />
    </label>
  </div>
{/snippet}

{#snippet group(label: string, body: Snippet)}
  <div class="grp">
    <span class="label">{label}</span>
    {@render body()}
  </div>
{/snippet}

{#snippet sizes(value: number, set: (w: number) => void, label: string)}
  <div class="seg" role="group" aria-label={label}>
    {#each widths as w (w)}
      <button type="button" aria-pressed={value === w} aria-label="{w} point" onclick={() => set(w)}><i class="thick" style:height="{w + 0.5}px"></i></button>
    {/each}
  </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="editor" onkeydown={keys}>
  <div class="top">
    <p class="file">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 3h8l4 4v14H6z M14 3v4h4" stroke-linejoin="round" /></svg>
      <span class="truncate">{file.name}</span>
      <span class="mono shrink-0">· {doc.numPages} {doc.numPages === 1 ? 'page' : 'pages'}</span>
    </p>
    <button type="button" class="btn btn-sm" onclick={leave}>Choose another PDF</button>
  </div>

  <div class="tools" role="group" aria-label="Tools">
    {#each tools as t (t)}
      <button type="button" class="tool" aria-pressed={ed.tool === t} onclick={() => pick(t)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{@html toolIcons[t]}</svg>
        <span>{toolLabels[t]}</span>
      </button>
    {/each}
    <span class="sep" aria-hidden="true"></span>
    <button type="button" class="tool" disabled={!ed.past.length} onclick={() => ed.undo()} title="Undo (Ctrl+Z)">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7L4.5 11.5 9 16M5 11.5h9a5 5 0 0 1 0 10h-2" /></svg>
      <span>Undo</span>
    </button>
    <button type="button" class="tool" disabled={!ed.future.length} onclick={() => ed.redo()} title="Redo (Ctrl+Shift+Z)">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7l4.5 4.5L15 16M19 11.5h-9a5 5 0 0 0 0 10h2" /></svg>
      <span>Redo</span>
    </button>
  </div>
  <input bind:this={imageInput} type="file" accept="image/*,.heic,.heif" hidden onchange={(e) => (addImage(e.currentTarget.files), (e.currentTarget.value = ''))} />

  <div class="bar">
    {#if busy}
      <p class="mono">{busy}</p>
    {:else if panel === 'place'}
      <p class="hint">Click on a page where it should go.</p>
      <button type="button" class="btn btn-sm" onclick={placeInView}>Put it on page {current + 1}</button>
      <button type="button" class="btn btn-sm" onclick={() => ((ed.pending = null), (ed.tool = 'select'))}>Cancel</button>
    {:else if panel === 'sig'}
      {@const role = ed.tool === 'initials' ? 'initials' : 'signature'}
      <span class="label m-0!">{role === 'initials' ? 'your initials' : 'your signatures'}</span>
      <div class="sigs">
        {#each ed.sigs.filter((s) => s.role === role) as s (s.id)}
          <span class="sig">
            <button type="button" class="use" aria-label="Use this {role}" onclick={() => useSig(s)}><img src={ed.assets.get(s.asset)?.url} alt="Saved {role}" /></button>
            {#if s.saved}<button type="button" class="forget" aria-label="Forget this {role} on this device" title="Forget on this device" onclick={() => forget(s)}>×</button>{/if}
          </span>
        {/each}
        <button type="button" class="btn btn-sm" onclick={() => (maker = role)}>+ New {role === 'initials' ? 'initials' : 'signature'}</button>
      </div>
    {:else if panel === 'text'}
      {#if !cur && ed.tool === 'name'}
        {#snippet nameBody()}<input class="field small w-44!" bind:value={ed.name} placeholder="Jane Doe" autocomplete="name" aria-label="Name to add" />{/snippet}
        {@render group('name', nameBody)}
      {/if}
      {#if !cur && ed.tool === 'date'}
        {#snippet dateBody()}
          <div class="flex gap-2">
            <input
              class="field small w-38!"
              type="date"
              aria-label="Date to add"
              value={formatDate(ed.date, 'iso')}
              onchange={(e) => {
                const [y, m, d] = e.currentTarget.value.split('-').map(Number);
                if (y) ed.date = new Date(y, m - 1, d);
              }}
            />
            <select class="field small w-auto!" aria-label="Date format" value={ed.style.dateFormat} onchange={(e) => (ed.style.dateFormat = e.currentTarget.value as DateFormat)}>
              {#each dateFormats as f (f)}<option value={f}>{formatDate(ed.date, f)}</option>{/each}
            </select>
          </div>
        {/snippet}
        {@render group('date', dateBody)}
      {/if}
      {#snippet fontBody()}
        <div class="seg" role="group" aria-label="Font">
          {#each ['sans', 'serif', 'mono'] as const as f (f)}
            <button type="button" aria-pressed={textStyle.font === f} onclick={() => setText({ font: f })}>{fontLabels[f]}</button>
          {/each}
          <button type="button" aria-pressed={textStyle.bold} aria-label="Bold" onclick={() => setText({ bold: !textStyle.bold })}><b>B</b></button>
        </div>
      {/snippet}
      {@render group('font', fontBody)}
      {#snippet sizeBody()}
        <div class="stepper">
          <button type="button" aria-label="Smaller text" onclick={() => setText({ size: Math.max(4, Math.round(textStyle.size) - 1) })}>−</button>
          <input
            class="field small"
            type="number"
            min="4"
            max="300"
            aria-label="Text size in points"
            value={Math.round(textStyle.size * 10) / 10}
            onchange={(e) => {
              const v = Number(e.currentTarget.value);
              if (v >= 4 && v <= 300) setText({ size: v });
            }}
          />
          <button type="button" aria-label="Larger text" onclick={() => setText({ size: Math.min(300, Math.round(textStyle.size) + 1) })}>+</button>
        </div>
      {/snippet}
      {@render group('size', sizeBody)}
      {#snippet colorBody()}{@render colors(swatches, textStyle.color, (c) => c && setText({ color: c }), 'Text color')}{/snippet}
      {@render group('color', colorBody)}
    {:else if panel === 'shape'}
      {#snippet fillBody()}{@render colors(swatches, shapeStyle.fill, (c) => setShape({ fill: c }), 'Fill', true)}{/snippet}
      {@render group('fill', fillBody)}
      {#snippet strokeBody()}{@render colors(swatches, shapeStyle.stroke, (c) => setShape({ stroke: c }), 'Border', true)}{/snippet}
      {@render group('border', strokeBody)}
      {#if shapeStyle.stroke}
        {#snippet widthBody()}{@render sizes(shapeStyle.strokeWidth, (w) => setShape({ strokeWidth: w }), 'Border width')}{/snippet}
        {@render group('width', widthBody)}
      {/if}
      {#snippet opacityBody()}
        <input type="range" min="0.1" max="1" step="0.05" value={shapeStyle.opacity} aria-label="Opacity" class="w-24 accent-(--color-sun)" oninput={(e) => setShape({ opacity: Number(e.currentTarget.value) })} />
      {/snippet}
      {@render group(`opacity · ${Math.round(shapeStyle.opacity * 100)}%`, opacityBody)}
    {:else if panel === 'whiteout'}
      <p class="hint">{toolHint.whiteout}</p>
    {:else if panel === 'highlight'}
      {#snippet hlBody()}
        <div class="swatches" role="group" aria-label="Highlight color">
          {#each highlightColors as c (c)}
            <button type="button" class="sw" style:--c={c} aria-pressed={(cur?.kind === 'highlight' ? cur.color : ed.style.highlight) === c} aria-label={c} onclick={() => setHighlight(c)}></button>
          {/each}
        </div>
      {/snippet}
      {@render group('color', hlBody)}
      {#if !cur}<p class="hint">{toolHint.highlight}</p>{/if}
    {:else if panel === 'mark'}
      {#if cur?.kind === 'mark'}
        {@const m = cur}
        {#snippet markBody()}
          <div class="seg" role="group" aria-label="Mark">
            <button type="button" aria-pressed={m.mark === 'check'} onclick={() => ed.update(m.id, { mark: 'check' })}>✓ check</button>
            <button type="button" aria-pressed={m.mark === 'cross'} onclick={() => ed.update(m.id, { mark: 'cross' })}>✕ cross</button>
          </div>
        {/snippet}
        {@render group('mark', markBody)}
      {/if}
      {#snippet markColor()}{@render colors(swatches.slice(0, 5), cur?.kind === 'mark' ? cur.color : ed.style.mark.color, (c) => c && setMark(c), 'Mark color')}{/snippet}
      {@render group('color', markColor)}
    {:else if panel === 'line'}
      {#snippet kindBody()}
        <div class="seg" role="group" aria-label="Line end">
          <button type="button" aria-pressed={!lineStyle.arrow} onclick={() => setLine({ arrow: false })}>line</button>
          <button type="button" aria-pressed={lineStyle.arrow} onclick={() => setLine({ arrow: true })}>arrow</button>
        </div>
      {/snippet}
      {@render group('end', kindBody)}
      {#snippet lineWidth()}{@render sizes(lineStyle.width, (w) => setLine({ width: w }), 'Line width')}{/snippet}
      {@render group('width', lineWidth)}
      {#snippet lineColor()}{@render colors(swatches, lineStyle.color, (c) => c && setLine({ color: c }), 'Line color')}{/snippet}
      {@render group('color', lineColor)}
    {:else if panel === 'ink'}
      {#snippet inkWidth()}{@render sizes(inkStyle.width, (w) => setInk({ width: w }), 'Pen width')}{/snippet}
      {@render group('pen', inkWidth)}
      {#snippet inkColor()}{@render colors(swatches, inkStyle.color, (c) => c && setInk({ color: c }), 'Pen color')}{/snippet}
      {@render group('color', inkColor)}
    {:else if panel === 'image' && cur?.kind === 'image'}
      {@const img = cur}
      {#snippet imgOpacity()}
        <input type="range" min="0.1" max="1" step="0.05" value={img.opacity} aria-label="Opacity" class="w-28 accent-(--color-sun)" oninput={(e) => ed.update(img.id, { opacity: Number(e.currentTarget.value) })} />
      {/snippet}
      {@render group(`opacity · ${Math.round(img.opacity * 100)}%`, imgOpacity)}
      <p class="hint">Drag a corner to resize. Hold Shift to stretch freely.</p>
    {:else}
      <p class="hint">Pick a tool, then click or drag on a page. Select anything you've added to move, resize or delete it.</p>
    {/if}

    {#if !cur && (clickTools.includes(ed.tool) || keyDrawable(ed.tool)) && !ed.pending && !busy}
      {#if panel !== 'whiteout' && panel !== 'highlight'}<p class="hint">{toolHint[ed.tool]}</p>{/if}
      <button type="button" class="btn btn-sm" onclick={placeInView}>Add to page {current + 1}</button>
    {:else if !cur && ed.tool === 'ink'}
      <p class="hint">{toolHint.ink}</p>
    {/if}

    {#if cur}
      <span class="actions">
        {#if cur.kind === 'text'}
          {@const t = cur}
          <button type="button" class="btn btn-sm" onclick={() => ed.startEditing(t.id)}>Edit text</button>
        {/if}
        <button type="button" class="btn btn-sm" onclick={() => (ed.duplicate(cur.id), focusSelected())} title="Duplicate (Ctrl+D)">Duplicate</button>
        <button type="button" class="btn btn-sm danger" onclick={() => ed.remove(cur.id)} title="Delete (Del)">Delete</button>
      </span>
    {/if}
  </div>
  {#if notice}<p class="mono mt-2 text-sun!" role="status">{notice}</p>{/if}

  <div class="viewer" bind:this={scroller} bind:clientWidth={viewW} bind:clientHeight={viewH} onscroll={(e) => (scrollY = e.currentTarget.scrollTop)}>
    {#if loadError}
      <p class="m-auto p-10 text-center text-bad" role="alert">{loadError}</p>
    {:else if !pages.length || !viewW}
      <p class="mono m-auto p-10 text-center" role="status">Reading pages…</p>
    {:else}
      <div class="pages" style:padding-top="{TOP}px">
        {#each pages as info, i (i)}
          <div class="slot" style:margin-bottom="{GAP}px">
            <span class="num mono" aria-hidden="true">{i + 1}</span>
            <OverlayPage {ed} {doc} index={i} {info} {k} near={isNear(i)} describedby="{id}-keys" />
          </div>
        {/each}
        {#if pages.length < doc.numPages}<p class="mono pb-8 text-center">Reading pages… {pages.length} of {doc.numPages}</p>{/if}
      </div>
    {/if}
  </div>

  <div class="foot">
    <div class="zoom" role="group" aria-label="Zoom">
      <span class="mono page-no">page {Math.min(current + 1, doc.numPages)} / {doc.numPages}</span>
      <button type="button" class="zb" aria-label="Zoom out" onclick={() => stepZoom(-1)}>−</button>
      <button type="button" class="zb pct mono" title="Fit to width" onclick={() => setZoom(1)} aria-label="Fit to width, now {Math.round((k / (96 / 72)) * 100)}%">{Math.round((k / (96 / 72)) * 100)}%</button>
      <button type="button" class="zb" aria-label="Zoom in" onclick={() => stepZoom(1)}>+</button>
    </div>
    <div class="save">
      {#if note}<div class="note">{@render note()}</div>{/if}
      <button type="button" class="btn btn-primary" disabled={saving || !live || pages.length < doc.numPages} onclick={save}>
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  </div>

  {#if result}
    <p class="done" role="status">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
      <span>Saved <b>{result.name}</b> <span class="mono">· {result.size}</span></span>
    </p>
  {/if}
  {#if warning}<p class="mt-2 text-sm text-sun" role="status">{warning}</p>{/if}
  {#if error}<p class="mt-2 text-sm text-bad" role="alert">{error}</p>{/if}
  <p class="sr-only" id="{id}-keys">Shortcuts: arrow keys move the selected item, Shift moves further, Ctrl or Command with arrows resizes, Delete removes, Ctrl+Z undoes, Ctrl+D duplicates.</p>
</div>

{#if maker}
  {@const role = maker}
  <SignatureMaker {role} name={ed.name} oncreate={(m) => made(role, m)} oncancel={() => (maker = null)} />
{/if}

<style>
  .editor {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 15px;
    & svg {
      flex: none;
      color: var(--color-pdf);
    }
  }
  .btn-sm {
    padding: 8px 12px;
    font-size: 13.5px;
    border-radius: 10px;
    white-space: nowrap;
  }
  .danger:hover {
    border-color: var(--color-bad);
    color: var(--color-bad);
  }
  .tools {
    display: flex;
    gap: 4px;
    padding: 6px;
    overflow-x: auto;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
    background: var(--color-panel-2);
    scrollbar-width: thin;
  }
  .tool {
    flex: none;
    display: grid;
    justify-items: center;
    gap: 3px;
    min-width: 58px;
    padding: 7px 6px 5px;
    color: var(--color-soft);
    background: none;
    border: 1px solid transparent;
    border-radius: 10px;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s, transform 0.2s var(--ease-spring);
    & span {
      font: 400 11px var(--font-mono);
      white-space: nowrap;
    }
    &:hover:not(:disabled) {
      color: var(--color-chalk);
      background: #f2ede40d;
    }
    &:active:not(:disabled) {
      transform: scale(0.94);
    }
    &[aria-pressed='true'] {
      color: var(--color-bg);
      background: var(--color-sun);
    }
    &:disabled {
      opacity: 0.35;
      cursor: default;
    }
  }
  .sep {
    flex: none;
    width: 1px;
    margin: 6px 4px;
    background: var(--color-line-2);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px 18px;
    min-height: 58px;
    padding: 4px 2px;
  }
  .grp .label {
    margin-bottom: 4px;
  }
  .hint {
    align-self: center;
    font-size: 14px;
    color: var(--color-soft);
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .field.small {
    padding: 6px 10px;
    font-size: 14px;
    border-radius: 10px;
  }
  .seg button {
    padding: 7px 11px;
  }
  .thick {
    display: block;
    width: 18px;
    min-height: 1px;
    background: currentColor;
    border-radius: 2px;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 4px;
    & button {
      width: 32px;
      height: 34px;
      color: var(--color-chalk);
      background: var(--color-panel-2);
      border: 1px solid var(--color-line-2);
      border-radius: 10px;
      cursor: pointer;
      &:hover {
        border-color: var(--color-muted);
      }
    }
    & input {
      width: 62px;
      text-align: center;
    }
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .sw {
    position: relative;
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 50%;
    background: var(--c);
    border: 1px solid #f2ede433;
    cursor: pointer;
    transition: transform 0.2s var(--ease-spring);
    &:hover {
      transform: scale(1.1);
    }
    &[aria-pressed='true'] {
      box-shadow:
        0 0 0 2px var(--color-bg),
        0 0 0 4px var(--color-sun);
    }
    &.none {
      background: linear-gradient(135deg, transparent 45%, var(--color-bad) 45% 55%, transparent 55%), #141312;
    }
    &.custom {
      overflow: hidden;
      background: conic-gradient(#ff6b4a, #ffd25e, #9be58f, #5fe0d0, #7cc4ff, #c8a6ff, #ff8fb8, #ff6b4a);
      &:focus-within {
        outline: 2px solid var(--color-sun);
        outline-offset: 2px;
      }
      & input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
      }
    }
  }
  .sigs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .sig {
    position: relative;
    & .use {
      display: grid;
      place-items: center;
      width: 132px;
      height: 52px;
      padding: 6px 10px;
      background: #fbfaf7;
      border: 2px solid transparent;
      border-radius: 10px;
      cursor: pointer;
      transition: border-color 0.15s, transform 0.2s var(--ease-spring);
      &:hover {
        border-color: var(--color-sun);
      }
      &:active {
        transform: scale(0.97);
      }
      & img {
        max-width: 100%;
        max-height: 100%;
      }
    }
    & .forget {
      position: absolute;
      top: -7px;
      right: -7px;
      width: 20px;
      height: 20px;
      font-size: 13px;
      line-height: 1;
      color: var(--color-soft);
      background: var(--color-panel-2);
      border: 1px solid var(--color-line-2);
      border-radius: 50%;
      cursor: pointer;
      &:hover {
        color: var(--color-bad);
      }
    }
  }
  .viewer {
    position: relative;
    display: flex;
    height: clamp(420px, 72vh, 980px);
    overflow: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--color-line-2);
    border-radius: 16px;
    background:
      radial-gradient(circle at 1px 1px, #f2ede414 1px, transparent 0) 0 0 / 18px 18px,
      #100f0e;
  }
  .pages {
    flex: none;
    min-width: 100%;
    width: max-content;
    padding-inline: 16px;
  }
  .slot {
    position: relative;
  }
  .num {
    position: absolute;
    left: 50%;
    top: -22px;
    transform: translateX(-50%);
    font-size: 11px;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .page-no {
    margin-right: 8px;
  }
  .zb {
    min-width: 34px;
    height: 34px;
    padding: 0 8px;
    color: var(--color-chalk);
    background: var(--color-panel-2);
    border: 1px solid var(--color-line-2);
    border-radius: 10px;
    cursor: pointer;
    &:hover {
      border-color: var(--color-muted);
    }
    &.pct {
      min-width: 62px;
      color: var(--color-soft);
    }
  }
  .save {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-left: auto;
  }
  .note {
    max-width: 380px;
    font-size: 13px;
    color: var(--color-muted);
    text-align: right;
  }
  .done {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    color: var(--color-ok);
    font-size: 15px;
    animation: pop 0.45s var(--ease-spring);
    & svg {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    & path {
      stroke-dasharray: 16;
      stroke-dashoffset: 16;
      animation: tick 0.4s 0.15s ease-out forwards;
    }
    & b {
      font-weight: 500;
      color: var(--color-chalk);
      overflow-wrap: anywhere;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.97);
    }
  }
  @keyframes tick {
    to {
      stroke-dashoffset: 0;
    }
  }
  @media (max-width: 640px) {
    .note {
      text-align: left;
      max-width: none;
    }
    .save {
      margin-left: 0;
      justify-content: flex-start;
    }
  }
</style>

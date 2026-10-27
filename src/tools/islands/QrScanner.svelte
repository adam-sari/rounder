<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Dropzone from '@/components/tool/Dropzone.svelte';
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import { decodeImage } from '@/engines/image/client';
  import { downloadBlob } from '@/tools/lib/files';
  import { closeScanner, scanPixels, type Found } from '@/tools/lib/qr-code-scanner/client';
  import { kindLabels, parseContent, type Content } from '@/tools/lib/qr-code-scanner/parse';
  import { toCsv } from '@/tools/lib/qr-code-scanner/csv';

  interface Hit {
    id: number;
    found: Found;
    content: Content;
    source: 'camera' | 'image';
    time: Date;
  }

  /** largest side of a camera frame we scan: enough for small barcodes, light enough to keep up */
  const FRAME_MAX = 1600;
  /** pause between camera scans */
  const INTERVAL = 140;
  const ACCEPT = 'image/*,.heic,.heif,.avif';
  const SMALL = 'px-3! py-[7px]! text-[13px]! rounded-[9px]!';
  /** the confirm step takes focus so keyboard users land on it; Cancel is the safe default */
  const focusNow = (el: HTMLElement) => el.focus();

  let mode = $state<'camera' | 'image'>('image');
  let history = $state.raw<Hit[]>([]);
  let selectedId = $state<number | null>(null);
  const selected = $derived(history.find((h) => h.id === selectedId) ?? null);
  /** the link waiting for a second click before it opens */
  let confirmFor = $state<number | null>(null);
  let hitId = 0;

  // image scanning
  let picture = $state<HTMLCanvasElement>();
  let shot = $state.raw<{ width: number; height: number; hits: Hit[] } | null>(null);
  let loading = $state(false);
  let imageError = $state('');
  let notFound = $state(false);
  let loadId = 0;
  let moreInput = $state<HTMLInputElement>();

  // camera scanning
  let video = $state<HTMLVideoElement>();
  let stream: MediaStream | null = null;
  let camStatus = $state<'idle' | 'starting' | 'live'>('idle');
  let camError = $state('');
  let cameras = $state.raw<MediaDeviceInfo[]>([]);
  let deviceId = '';
  let torchable = $state(false);
  let torch = $state(false);
  let frame = $state({ width: 1, height: 1 });
  let outlines = $state.raw<[number, number][][]>([]);
  let outlineTimer: ReturnType<typeof setTimeout>;
  let flash = $state(0);
  /** the codes in the last live frame, so the selection only follows the camera when what's in view changes */
  let inView = '';
  /** bumping this ends the running scan loop */
  let run = 0;

  const sameCode = (h: Hit, f: Found) => h.found.format === f.format && h.found.text === f.text;

  /** adds codes to the session history; a code scanned before moves back to the top instead of repeating */
  function record(found: Found[], source: Hit['source']): Hit[] {
    // a sheet of labels can repeat a code; every copy is marked on the image but listed once
    const seen = new Map<string, number>();
    const hits = found.map((f) => {
      const key = `${f.format}\n${f.text}`;
      const id = seen.get(key) ?? history.find((h) => sameCode(h, f))?.id ?? ++hitId;
      seen.set(key, id);
      return { id, found: f, content: parseContent(f.text, f.format), source, time: new Date() };
    });
    const unique = hits.filter((h, i) => hits.findIndex((o) => o.id === h.id) === i);
    history = [...unique, ...history.filter((h) => !seen.has(`${h.found.format}\n${h.found.text}`))];
    return hits;
  }

  function isImage(f: File) {
    return f.type.startsWith('image/') || /\.(heic|heif|avif)$/i.test(f.name);
  }

  const NOT_IMAGE = "That file isn't an image. Choose a photo or screenshot: JPG, PNG, WebP, AVIF, HEIC, GIF or SVG.";

  function rejectNonImages(list: FileList | null | undefined) {
    const files = Array.from(list ?? []);
    if (files.length && !files.some(isImage)) imageError = NOT_IMAGE;
  }

  async function loadImage(files: File[]) {
    const f = files.find(isImage);
    if (!f) {
      if (files.length) imageError = NOT_IMAGE;
      return;
    }
    mode = 'image';
    stopCamera();
    const id = ++loadId;
    loading = true;
    imageError = '';
    notFound = false;
    let decoded = false;
    try {
      const img = await decodeImage(f);
      if (id !== loadId) return;
      decoded = true;
      shot = { width: img.width, height: img.height, hits: [] };
      await tick();
      if (picture) {
        picture.width = img.width;
        picture.height = img.height;
        picture.getContext('2d')!.putImageData(img, 0, 0);
      }
      const found = await scanPixels(img);
      if (id !== loadId) return;
      const hits = record(found, 'image');
      shot = { width: shot.width, height: shot.height, hits };
      notFound = !hits.length;
      if (hits.length) selectedId = hits[0].id;
    } catch {
      if (id !== loadId) return;
      shot = null;
      imageError = decoded
        ? 'Something went wrong while scanning this image. Try again, or try a smaller copy.'
        : "Couldn't read that image. Try a JPG, PNG, WebP, AVIF, HEIC, GIF or SVG.";
    } finally {
      if (id === loadId) loading = false;
    }
  }

  function cameraMessage(err: unknown) {
    const name = (err as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again. You can also scan a photo or screenshot instead.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. You can scan a photo or screenshot instead.';
    if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is busy, probably in use by another app or tab. Close it there and try again.';
    return "The camera couldn't start. Try again, or scan a photo or screenshot instead.";
  }

  async function startCamera(id = deviceId) {
    stopCamera();
    camError = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      camError = "This browser can't use the camera here. Camera access needs a secure (https) page in a modern browser. You can still scan a photo or screenshot.";
      return;
    }
    const gen = ++run;
    camStatus = 'starting';
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' } }), width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (gen !== run || !video) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      const track = s.getVideoTracks()[0];
      deviceId = track.getSettings().deviceId ?? '';
      torchable = !!(track.getCapabilities?.() as { torch?: unknown } | undefined)?.torch;
      video.srcObject = s;
      await video.play();
      // device labels are only filled in once permission is granted
      cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      if (gen !== run) return;
      camStatus = 'live';
      loop(gen);
    } catch (err) {
      if (gen !== run) return;
      stopCamera();
      camError = cameraMessage(err);
    }
  }

  function stopCamera() {
    run++;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) video.srcObject = null;
    camStatus = 'idle';
    torch = false;
    torchable = false;
    outlines = [];
    inView = '';
  }

  function switchCamera() {
    const i = cameras.findIndex((c) => c.deviceId === deviceId);
    startCamera(cameras[(i + 1) % cameras.length].deviceId);
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as unknown as MediaTrackConstraintSet] });
      torch = !torch;
    } catch {
      torchable = false;
    }
  }

  async function loop(gen: number) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let failures = 0;
    while (gen === run) {
      const started = performance.now();
      const v = video;
      if (v && v.readyState >= 2 && v.videoWidth) {
        const scale = Math.min(1, FRAME_MAX / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * scale);
        const h = Math.round(v.videoHeight * scale);
        if (canvas.width !== w || canvas.height !== h) Object.assign(canvas, { width: w, height: h });
        ctx.drawImage(v, 0, 0, w, h);
        try {
          const found = await scanPixels(ctx.getImageData(0, 0, w, h), true);
          if (gen !== run) break;
          if (frame.width !== w || frame.height !== h) frame = { width: w, height: h };
          failures = 0;
          if (found.length) onLive(found);
        } catch {
          if (gen !== run) break;
          // one dropped frame is fine, but a reader that keeps failing (e.g. it couldn't load) shouldn't look like "no code yet"
          if (++failures >= 5) {
            stopCamera();
            camError = 'The code reader stopped working. Reload the page and try again, or scan a photo or screenshot instead.';
          }
        }
      }
      await new Promise((r) => setTimeout(r, Math.max(30, INTERVAL - (performance.now() - started))));
    }
  }

  function onLive(found: Found[]) {
    outlines = found.map((f) => f.corners);
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => {
      outlines = [];
      inView = '';
    }, 500);
    // while the same codes stay in view, leave the selection alone so a tap on the history sticks
    const key = found.map((f) => `${f.format}\n${f.text}`).sort().join('\n\n');
    if (key === inView) return;
    inView = key;
    // only new codes are added, so a code held in view doesn't reshuffle the history every frame
    const fresh = found.filter((f) => !history.some((h) => sameCode(h, f)));
    if (fresh.length) {
      selectedId = record(fresh, 'camera')[0].id;
      flash++;
      navigator.vibrate?.(40);
    } else if (!found.some((f) => selected && sameCode(selected, f))) {
      selectedId = history.find((h) => sameCode(h, found[0]))?.id ?? selectedId;
    }
  }

  function setMode(m: 'camera' | 'image') {
    mode = m;
    if (m === 'image') stopCamera();
  }

  onMount(() => {
    if (matchMedia('(pointer: coarse)').matches) mode = 'camera';
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.some(isImage)) loadImage(files);
    };
    // don't leave the camera running in a background tab
    const onVisibility = () => {
      if (document.hidden && stream) stopCamera();
    };
    window.addEventListener('paste', onPaste);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('paste', onPaste);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(outlineTimer);
      stopCamera();
      closeScanner();
    };
  });

  const points = (corners: [number, number][]) => corners.map((p) => p.join(',')).join(' ');

  function preview(c: Content): string {
    switch (c.kind) {
      case 'url': return c.url;
      case 'wifi': return c.ssid || '(hidden name)';
      case 'contact': return c.contact.name || c.contact.phones[0] || c.contact.emails[0] || 'contact';
      case 'email': return c.to || c.subject;
      case 'phone': return c.number;
      case 'sms': return c.number || c.body;
      case 'geo': return `${c.lat}, ${c.lon}`;
      case 'event': return c.summary || c.start;
      case 'product': return c.code;
      case 'text': return c.text;
    }
  }

  /** the link split so the site name stands out: lookalike domains are easier to spot */
  function urlParts(url: string, host: string) {
    const start = url.indexOf(host, url.indexOf('//') + 2);
    if (start < 0) return { pre: '', host: '', post: url };
    return { pre: url.slice(0, start), host, post: url.slice(start + host.length) };
  }

  const securityLabel = (s: string) => (s === 'none' ? 'Open, no password' : s === 'WPA' ? 'WPA / WPA2 / WPA3' : s);

  const safeName = (s: string, fallback: string) => s.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || fallback;

  function mailto(c: Extract<Content, { kind: 'email' }>) {
    const q = new URLSearchParams();
    if (c.subject) q.set('subject', c.subject);
    if (c.body) q.set('body', c.body);
    const qs = q.toString().replace(/\+/g, '%20');
    return `mailto:${encodeURI(c.to)}${qs ? `?${qs}` : ''}`;
  }

  const dial = (n: string) => n.replace(/[^\d+*#,;]/g, '');

  function downloadCsv() {
    const rows = history.map((h) => [h.time.toISOString(), h.found.label, kindLabels[h.content.kind], h.found.text]);
    // the BOM makes Excel read the file as UTF-8, so accents and emoji survive
    downloadBlob(new Blob(['﻿' + toCsv([['scanned', 'format', 'type', 'content'], ...rows])], { type: 'text/csv' }), 'scanned-codes.csv');
  }

  function clearHistory() {
    history = [];
    selectedId = null;
    inView = '';
    if (shot) shot = { ...shot, hits: [] };
  }

  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

{#snippet field(label: string, value: string, copy = true)}
  {#if value}
    <div class="row">
      <div class="min-w-0">
        <span class="label">{label}</span>
        <div class="break-words whitespace-pre-wrap">{value}</div>
      </div>
      {#if copy}<CopyButton text={value} class={SMALL} />{/if}
    </div>
  {/if}
{/snippet}

{#snippet result(hit: Hit)}
  {@const c = hit.content}
  <article class="result card grid gap-4 p-5">
    <header class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="font-serif text-3xl leading-none">{kindLabels[c.kind]}</h3>
      <span class="mono">{hit.found.label} · {hit.source === 'camera' ? 'camera' : 'image'} · {time(hit.time)}</span>
    </header>

    {#if c.kind === 'url'}
      {@const parts = urlParts(c.url, c.host)}
      <div class="url mono" aria-label="Full link">
        <span>{parts.pre}</span><strong>{parts.host}</strong><span>{parts.post}</span>
      </div>
      {#if c.warnings.length}
        <ul class="grid gap-1.5 text-sm text-bad" role="list">
          {#each c.warnings as w}<li class="flex gap-2"><span aria-hidden="true">!</span>{w}</li>{/each}
        </ul>
      {/if}
      {#if confirmFor === hit.id}
        <div class="confirm grid gap-3" role="group" aria-label="Open this link?">
          <p class="text-sm">Open <strong class="text-sun">{c.host}</strong> in a new tab? Only continue if you trust where this code came from.</p>
          <div class="flex flex-wrap gap-2">
            <a class="btn btn-primary" href={c.url} target="_blank" rel="noopener noreferrer nofollow" onclick={() => (confirmFor = null)}>Yes, open it</a>
            <button type="button" class="btn" use:focusNow onclick={() => (confirmFor = null)}>Cancel</button>
          </div>
        </div>
      {:else}
        <div class="flex flex-wrap gap-2">
          <CopyButton text={c.url} label="Copy link" class="btn-primary" />
          <button type="button" class="btn" onclick={() => (confirmFor = hit.id)}>Open link…</button>
        </div>
        <p class="mono">check the site name in bold before opening · links never open by themselves</p>
      {/if}
    {:else if c.kind === 'wifi'}
      <div class="grid gap-3">
        {@render field('network name (SSID)', c.ssid)}
        {#if c.security === 'none'}
          {@render field('security', securityLabel(c.security), false)}
        {:else}
          {@render field('password', c.password || '(none given)', !!c.password)}
          {@render field('security', securityLabel(c.security) + (c.hidden ? ' · hidden network' : ''), false)}
        {/if}
      </div>
      <p class="mono">to join, pick the network in your Wi-Fi settings and paste the password</p>
    {:else if c.kind === 'contact'}
      <div class="grid gap-3">
        {@render field('name', c.contact.name)}
        {@render field('company', [c.contact.title, c.contact.org].filter(Boolean).join(', '), false)}
        {#each c.contact.phones as p}{@render field('phone', p)}{/each}
        {#each c.contact.emails as e}{@render field('email', e)}{/each}
        {#each c.contact.urls as u}{@render field('website', u)}{/each}
        {@render field('address', c.contact.address)}
        {@render field('note', c.contact.note, false)}
      </div>
      <button type="button" class="btn btn-primary justify-self-start" onclick={() => downloadBlob(new Blob([c.vcard], { type: 'text/vcard' }), `${safeName(c.contact.name, 'contact')}.vcf`)}>Save contact (.vcf)</button>
    {:else if c.kind === 'email'}
      <div class="grid gap-3">
        {@render field('to', c.to)}
        {@render field('subject', c.subject)}
        {@render field('message', c.body)}
      </div>
      {#if c.to}<a class="btn btn-primary justify-self-start" href={mailto(c)}>Write email</a>{/if}
    {:else if c.kind === 'phone'}
      {@render field('number', c.number)}
      <a class="btn btn-primary justify-self-start" href={`tel:${dial(c.number)}`}>Call</a>
    {:else if c.kind === 'sms'}
      <div class="grid gap-3">
        {@render field('to', c.number)}
        {@render field('message', c.body)}
      </div>
      {#if c.number}<a class="btn btn-primary justify-self-start" href={`sms:${dial(c.number)}${c.body ? `?body=${encodeURIComponent(c.body)}` : ''}`}>Send text</a>{/if}
    {:else if c.kind === 'geo'}
      <div class="grid gap-3">
        {@render field('coordinates', `${c.lat}, ${c.lon}`)}
        {@render field('place', c.query, false)}
      </div>
      <a class="btn btn-primary justify-self-start" href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=16/${c.lat}/${c.lon}`} target="_blank" rel="noopener noreferrer">Show on OpenStreetMap</a>
    {:else if c.kind === 'event'}
      <div class="grid gap-3">
        {@render field('event', c.summary, false)}
        {@render field('when', [c.start, c.end].filter(Boolean).join(' → '), false)}
        {@render field('where', c.location)}
        {@render field('details', c.description, false)}
      </div>
      <button type="button" class="btn btn-primary justify-self-start" onclick={() => downloadBlob(new Blob([c.ics], { type: 'text/calendar' }), `${safeName(c.summary, 'event')}.ics`)}>Add to calendar (.ics)</button>
    {:else if c.kind === 'product'}
      {@render field(c.scheme, c.code)}
      <a class="btn justify-self-start" href={`https://duckduckgo.com/?q=${encodeURIComponent(c.code)}`} target="_blank" rel="noopener noreferrer">Search the web for this code</a>
    {:else}
      <div class="text">{c.text}</div>
      {#if hit.found.binary}<p class="mono">this code holds binary data, so the text may look garbled</p>{/if}
      <CopyButton text={c.text} label="Copy text" class="btn-primary justify-self-start" />
    {/if}

    {#if c.kind !== 'text'}
      <details class="raw">
        <summary class="mono">raw content</summary>
        <div class="text mt-2">{hit.found.text}</div>
      </details>
    {/if}
  </article>
{/snippet}

<div class="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
  <section class="grid min-w-0 content-start gap-4" aria-label="Scan">
    <div class="seg" role="group" aria-label="Scan from">
      <button type="button" aria-pressed={mode === 'camera'} onclick={() => setMode('camera')}>camera</button>
      <button type="button" aria-pressed={mode === 'image'} onclick={() => setMode('image')}>image or screenshot</button>
    </div>

    {#if mode === 'camera'}
      <div
        class="finder"
        class:live={camStatus === 'live'}
        role="group"
        aria-label="Camera"
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => {
          // otherwise the browser navigates to the dropped file and the session history is lost
          e.preventDefault();
          loadImage(Array.from(e.dataTransfer?.files ?? []));
        }}
      >
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video} playsinline muted autoplay aria-label="Camera view"></video>
        {#if camStatus === 'live'}
          <svg class="overlay" viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            {#each outlines as corners}<polygon points={points(corners)} />{/each}
          </svg>
          <div class="brackets" aria-hidden="true"><span></span><span></span><span></span><span></span><i class="beam"></i></div>
          {#key flash}{#if flash}<div class="ping" aria-hidden="true"></div>{/if}{/key}
        {:else}
          <div class="idle">
            <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M6 16V8h8M34 8h8v8M42 32v8h-8M14 40H6v-8" stroke-linecap="round" />
              <rect x="15" y="15" width="7" height="7" rx="1.5" /><rect x="26" y="15" width="7" height="7" rx="1.5" /><rect x="15" y="26" width="7" height="7" rx="1.5" />
              <path d="M27 27h2v2M32 32v1" stroke-linecap="round" />
            </svg>
            <p class="font-serif text-2xl">Point your camera at a code</p>
            <button type="button" class="btn btn-primary" disabled={camStatus === 'starting'} onclick={() => startCamera()}>
              {camStatus === 'starting' ? 'Asking for the camera…' : 'Start camera'}
            </button>
          </div>
        {/if}
      </div>

      {#if camStatus === 'live'}
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn" onclick={stopCamera}>Stop camera</button>
          {#if cameras.length > 1}<button type="button" class="btn" onclick={switchCamera}>Switch camera</button>{/if}
          {#if torchable}<button type="button" class="btn" aria-pressed={torch} class:on={torch} onclick={toggleTorch}>{torch ? 'Flashlight on' : 'Flashlight'}</button>{/if}
        </div>
      {/if}
      {#if camError}<p class="text-sm text-bad" role="alert">{camError}</p>{/if}
      <p class="mono">the video stays on your device · nothing is recorded or uploaded</p>
    {/if}
    <!-- hidden rather than unmounted, so the scanned picture is still there after a trip to the camera tab -->
    <div class="grid min-w-0 content-start gap-4" hidden={mode !== 'image'}>
      {#if shot}
        <div
          class="stage"
          role="group"
          aria-label="Scanned image"
          ondragover={(e) => e.preventDefault()}
          ondrop={(e) => {
            e.preventDefault();
            loadImage(Array.from(e.dataTransfer?.files ?? []));
          }}
        >
          <canvas bind:this={picture} class:dim={loading}></canvas>
          <svg class="marks" viewBox={`0 0 ${shot.width} ${shot.height}`} aria-hidden="true">
            {#each shot.hits as hit, i}
              {@const [x, y] = hit.found.corners[0]}
              {@const r = Math.max(shot.width, shot.height) / 36}
              <polygon points={points(hit.found.corners)} class:sel={hit.id === selectedId} />
              <circle cx={x} cy={y} {r} class:sel={hit.id === selectedId} />
              <text {x} {y} dy="0.35em" font-size={r * 1.1}>{i + 1}</text>
            {/each}
          </svg>
          {#if loading}<div class="busy mono" role="status">scanning…</div>{/if}
        </div>
        {#if shot.hits.length > 1}
          <div class="flex flex-wrap gap-2" role="group" aria-label="Codes in this image">
            {#each shot.hits as hit, i}
              <button type="button" class="chip" aria-pressed={hit.id === selectedId} onclick={() => (selectedId = hit.id)}>
                <b>{i + 1}</b> {kindLabels[hit.content.kind]} <span class="mono">{hit.found.label}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if notFound}
          <p class="text-sm text-bad" role="alert">No QR code or barcode found. Try a sharper or closer picture with the whole code in view, or crop away the rest.</p>
        {/if}
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="btn" onclick={() => moreInput?.click()}>Scan another image</button>
          <span class="mono">or paste one with Ctrl+V / ⌘V</span>
        </div>
        <input bind:this={moreInput} type="file" accept={ACCEPT} hidden onchange={(e) => loadImage(Array.from(e.currentTarget.files ?? []))} />
      {:else}
        <!-- the shared dropzone drops wrong file types silently, so say why nothing happened -->
        <div class="grid" ondropcapture={(e) => rejectNonImages(e.dataTransfer?.files)} onchangecapture={(e) => rejectNonImages((e.target as HTMLInputElement).files)}>
          <Dropzone accept={ACCEPT} paste={false} title="Drop an image with a code" hint="or click to choose · paste a screenshot with Ctrl+V / ⌘V" onfiles={loadImage} />
        </div>
        {#if loading}<p class="mono" role="status">reading the image…</p>{/if}
      {/if}
      {#if imageError}<p class="text-sm text-bad" role="alert">{imageError}</p>{/if}
    </div>
  </section>

  <section class="grid min-w-0 content-start gap-4" aria-label="Results">
    {#if selected}
      <div aria-live="polite">{#key selected.id}{@render result(selected)}{/key}</div>
    {:else}
      <div class="empty">
        <div class="finder-mark" aria-hidden="true"><i></i><i></i><i></i></div>
        <p class="font-serif text-2xl">Nothing scanned yet</p>
        <p class="text-sm text-soft">Scan with your camera, or drop in a photo or screenshot. Links, Wi-Fi logins, contacts and barcodes show up here, and links never open on their own.</p>
      </div>
    {/if}

    {#if history.length}
      <div class="grid gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="label mb-0!">this session · {history.length} {history.length === 1 ? 'code' : 'codes'}</span>
          <div class="flex flex-wrap gap-1.5">
            <CopyButton text={() => history.map((h) => h.found.text).join('\n')} label="Copy all" class={SMALL} />
            <button type="button" class="btn {SMALL}" onclick={downloadCsv}>CSV</button>
            <button type="button" class="btn {SMALL}" onclick={clearHistory}>Clear</button>
          </div>
        </div>
        <ol class="history">
          {#each history as hit (hit.id)}
            <li>
              <button type="button" aria-pressed={hit.id === selectedId} onclick={() => (selectedId = hit.id)}>
                <span class="kind mono">{kindLabels[hit.content.kind]}</span>
                <span class="truncate">{preview(hit.content)}</span>
                <span class="mono when">{time(hit.time)}</span>
              </button>
            </li>
          {/each}
        </ol>
        <p class="mono">kept only until you close or reload this page</p>
      </div>
    {/if}
  </section>
</div>

<style>
  .finder {
    position: relative;
    aspect-ratio: 4 / 3;
    max-height: 70vh;
    overflow: hidden;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background:
      radial-gradient(circle at 50% 45%, #ffd25e10, transparent 60%),
      #0e0d0c;
  }
  video,
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  video {
    opacity: 0;
    transition: opacity 0.4s;
  }
  .finder.live video {
    opacity: 1;
  }
  .overlay polygon {
    fill: #ffd25e33;
    stroke: var(--color-sun);
    stroke-width: 3;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .idle {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 14px;
    padding: 20px;
    text-align: center;
    color: var(--color-soft);
  }
  .idle svg {
    color: var(--color-sun);
  }

  /* viewfinder corners with a slow scanning beam */
  .brackets {
    position: absolute;
    inset: 16% 22%;
    pointer-events: none;
  }
  .brackets span {
    position: absolute;
    width: 26px;
    height: 26px;
    border: 3px solid #f2ede4cc;
    border-radius: 4px;
  }
  .brackets span:nth-child(1) { top: 0; left: 0; border-right: 0; border-bottom: 0; }
  .brackets span:nth-child(2) { top: 0; right: 0; border-left: 0; border-bottom: 0; }
  .brackets span:nth-child(3) { bottom: 0; left: 0; border-right: 0; border-top: 0; }
  .brackets span:nth-child(4) { bottom: 0; right: 0; border-left: 0; border-top: 0; }
  .beam {
    position: absolute;
    left: 6%;
    right: 6%;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--color-sun), transparent);
    box-shadow: 0 0 12px var(--color-sun);
    animation: sweep 2.4s ease-in-out infinite alternate;
  }
  @keyframes sweep {
    from { top: 4%; opacity: 0.4; }
    to { top: 96%; opacity: 1; }
  }
  .ping {
    position: absolute;
    inset: 16% 22%;
    border: 3px solid var(--color-ok);
    border-radius: 14px;
    pointer-events: none;
    animation: ping 0.6s ease-out forwards;
  }
  @keyframes ping {
    from { opacity: 1; transform: scale(0.96); }
    to { opacity: 0; transform: scale(1.08); }
  }
  @media (prefers-reduced-motion: reduce) {
    .beam { display: none; }
  }

  .stage {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--color-line-2);
    border-radius: 18px;
    background: repeating-conic-gradient(#ffffff0a 0 25%, transparent 0 50%) 0 0 / 20px 20px;
  }
  .stage canvas {
    display: block;
    width: 100%;
    height: auto;
    max-height: 70vh;
    object-fit: contain;
    transition: opacity 0.2s;
  }
  .stage canvas.dim {
    opacity: 0.4;
  }
  .marks {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .marks polygon {
    fill: #ffd25e1f;
    stroke: var(--color-sun);
    stroke-width: 2.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
    animation: draw 0.5s ease-out both;
  }
  .marks polygon.sel {
    fill: #ffd25e40;
    stroke-width: 4;
  }
  .marks circle {
    fill: var(--color-bg);
    stroke: var(--color-sun);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .marks circle.sel {
    fill: var(--color-sun);
  }
  .marks text {
    fill: var(--color-chalk);
    text-anchor: middle;
    font-family: var(--font-mono);
  }
  .marks circle.sel + text {
    fill: var(--color-bg);
  }
  @keyframes draw {
    from { opacity: 0; }
  }
  .busy {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--color-chalk);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 999px;
    background: transparent;
    color: var(--color-chalk);
    font-size: 14px;
    cursor: pointer;
  }
  .chip b {
    font: 500 12px var(--font-mono);
    color: var(--color-sun);
  }
  .chip[aria-pressed='true'] {
    border-color: var(--color-sun);
    background: #ffd25e14;
  }

  .result {
    animation: rise 0.35s var(--ease-spring) both;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(8px); }
  }
  .row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--color-line);
  }
  .url {
    font-size: 14px;
    line-height: 1.6;
    word-break: break-all;
    color: var(--color-muted);
    background: #141312;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    padding: 12px 14px;
    max-height: 220px;
    overflow: auto;
  }
  .url strong {
    color: var(--color-chalk);
    font-weight: 600;
  }
  .confirm {
    padding: 14px;
    border: 1px solid #ffd25e66;
    border-radius: 12px;
    background: #ffd25e0d;
  }
  .text {
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 320px;
    overflow: auto;
    background: #141312;
    border: 1px solid var(--color-line-2);
    border-radius: 12px;
    padding: 12px 14px;
    font: 400 14px/1.6 var(--font-mono);
  }
  .raw summary {
    cursor: pointer;
    width: fit-content;
  }
  .btn.on {
    border-color: var(--color-sun);
    color: var(--color-sun);
  }

  .empty {
    display: grid;
    justify-items: center;
    gap: 10px;
    text-align: center;
    padding: 40px 24px;
    border: 1.5px dashed var(--color-line-2);
    border-radius: 18px;
  }
  .empty p:last-child {
    max-width: 34ch;
  }
  /* three QR finder squares */
  .finder-mark {
    display: grid;
    grid-template-columns: repeat(2, 22px);
    gap: 10px;
    margin-bottom: 6px;
  }
  .finder-mark i {
    width: 22px;
    height: 22px;
    border: 3px solid var(--color-sun);
    border-radius: 6px;
    box-shadow: inset 0 0 0 3px var(--color-bg), inset 0 0 0 8px var(--color-sun);
  }

  .history {
    display: grid;
    max-height: 340px;
    overflow: auto;
    border: 1px solid var(--color-line-2);
    border-radius: 14px;
  }
  .history li + li {
    border-top: 1px solid var(--color-line);
  }
  .history button {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    text-align: left;
    font-size: 14px;
    color: var(--color-soft);
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .history button:hover {
    background: #f2ede40a;
  }
  .history button[aria-pressed='true'] {
    background: #ffd25e12;
    color: var(--color-chalk);
  }
  .history button[aria-pressed='true'] .kind {
    color: var(--color-sun);
  }
  .kind {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 420px) {
    .history button {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .kind {
      display: none;
    }
  }
</style>

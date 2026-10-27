<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import ImageBatch, { type BatchOutput } from '@/components/tool/ImageBatch.svelte';
  import { formatInfo, imageKind, outputFormatFor, processImage, type ImageKind } from '@/engines/image/client';
  import { formatBytes, withExtension, withSuffix } from '@/tools/lib/files';
  import { stripMetadata, type Found } from '@/tools/lib/exif/strip';
  import { formatCoords, osmLink, summarize, type Summary } from '@/tools/lib/exif/summary';

  let keepIcc = $state(true);
  let keepOrientation = $state(true);

  interface Report {
    file: File;
    found: Found[];
    reencoded: boolean;
    wroteOrientation: boolean;
    summary?: Summary;
  }

  // keyed by the File itself, so two photos with the same name keep separate reports
  const reports = new SvelteMap<File, Report>();
  // files that left the list, possibly while still being processed
  const gone = new WeakSet<File>();
  let selected = $state.raw<File | null>(null);

  async function readTags(file: File, kind: ImageKind, exif?: Uint8Array) {
    const { default: exifr } = await import('exifr');
    // exifr can't open WebP, but it can read the TIFF stream from its EXIF chunk
    const input = kind === 'webp' ? exif : file;
    if (!input) return {};
    const opts = { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, jfif: false, ihdr: false, ifd1: false, interop: false, makerNote: false, userComment: false, mergeOutput: true };
    return (await exifr.parse(input, opts).catch(() => undefined)) ?? {};
  }

  function track(file: File, kind: ImageKind, info: Omit<Report, 'file' | 'summary'>, exif?: Uint8Array) {
    // the file may have been removed, or the batch cleared, while it was being processed
    if (gone.has(file)) return;
    const existing = reports.get(file);
    if (existing) return void reports.set(file, { ...existing, ...info });
    reports.set(file, { file, ...info });
    readTags(file, kind, exif).then((tags) => {
      const r = reports.get(file);
      if (r) reports.set(file, { ...r, summary: summarize(tags) });
    });
  }

  function drop(file: File) {
    gone.add(file);
    reports.delete(file);
  }

  async function process(file: File): Promise<BatchOutput> {
    const kind = await imageKind(file);
    if (kind === 'jpeg' || kind === 'png' || kind === 'webp') {
      const res = stripMetadata(new Uint8Array(await file.arrayBuffer()), kind, { keepIcc, keepOrientation });
      const rotate = res.orientation !== 1 && !keepOrientation;
      // re-encoding keeps nothing, not even the color profile
      const found = rotate ? res.found.map((f) => ({ ...f, kept: false })) : res.found;
      track(file, kind, { found, reencoded: rotate, wroteOrientation: res.wroteOrientation }, res.exif);
      if (!rotate) {
        const removed = res.found.some((f) => !f.kept);
        return {
          blob: new Blob([res.bytes], { type: formatInfo[kind].mime }),
          name: withSuffix(file.name, '-clean'),
          note: removed ? `${formatBytes(Math.max(0, file.size - res.bytes.length))} of metadata removed${res.wroteOrientation ? ', rotation kept' : ''}` : 'already clean',
        };
      }
    } else {
      track(file, kind, { found: [], reencoded: true, wroteOrientation: false });
    }
    // HEIC, AVIF and photos being turned upright go through the image engine, which writes no metadata
    const format = outputFormatFor(kind);
    const out = await processImage(file, { encode: { format, quality: 92, background: '#ffffff' } });
    const upright = kind === 'jpeg' || kind === 'png' || kind === 'webp';
    return {
      blob: out.blob,
      name: withSuffix(withExtension(file.name, formatInfo[format].ext), '-clean'),
      width: out.width,
      height: out.height,
      note: `${upright ? 'turned upright, ' : ''}re-encoded as ${formatInfo[format].label}`,
    };
  }

  const settingsKey = $derived(JSON.stringify([keepIcc, keepOrientation]));
  const current = $derived(selected ? reports.get(selected) : undefined);
  const gps = $derived(current?.summary?.gps);
  const clean = $derived(current?.summary && !current.summary.all.length && !current.found.some((f) => !f.kept));
</script>

<ImageBatch
  {process}
  {settingsKey}
  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif"
  title="Drop photos here"
  hint="or click to choose · JPG, PNG, WebP, HEIC, AVIF"
  zipName="photos-without-metadata.zip"
  onselect={(file) => (selected = file)}
  onremove={drop}
>
  <label class="flex items-start gap-2 text-sm">
    <input type="checkbox" bind:checked={keepIcc} class="mt-1" />
    <span>Keep color profile<span class="mono block">keeps colors looking the same</span></span>
  </label>

  <div>
    <span class="label">sideways phone photos</span>
    <div class="seg" role="group" aria-label="Sideways phone photos">
      <button type="button" aria-pressed={keepOrientation} onclick={() => (keepOrientation = true)}>keep rotation tag</button>
      <button type="button" aria-pressed={!keepOrientation} onclick={() => (keepOrientation = false)}>rotate pixels</button>
    </div>
    <p class="mono mt-2">
      {keepOrientation
        ? 'Lossless. Writes back only a tiny rotation tag (under 40 bytes) so they stay upright.'
        : 'Turns them upright and re-encodes them, so no EXIF is left at all.'}
    </p>
  </div>

  <p class="mono">JPG, PNG and WebP are cleaned without re-encoding: every pixel stays the same. HEIC and AVIF are re-encoded (HEIC as JPG).</p>
</ImageBatch>

{#if current}
  <section class="mt-8 grid gap-5 border-t border-line pt-8" aria-labelledby="exif-inside">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id="exif-inside" class="text-3xl">What's <em>inside</em></h2>
      <p class="mono max-w-full truncate">{current.file.name}</p>
    </div>

    {#if !current.summary}
      <p class="mono"><span class="reading">reading metadata…</span></p>
    {:else}
      {#if gps}
        <div class="gps">
          <span class="badge"><span aria-hidden="true">●</span> This photo reveals where it was taken</span>
          <p class="mt-3 font-serif text-2xl leading-tight sm:text-3xl">{formatCoords(gps.lat, gps.lon)}</p>
          <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <a class="btn px-4! py-2! text-sm!" href={osmLink(gps.lat, gps.lon)} target="_blank" rel="noopener noreferrer">Open in OpenStreetMap ↗</a>
            <span class="mono">the cleaned copy doesn't include it</span>
          </div>
        </div>
      {/if}

      {#if current.found.length || current.reencoded || current.wroteOrientation}
        <ul class="flex flex-wrap gap-2" aria-label="Metadata blocks">
          {#each current.found as f (f.label)}
            <li class="pill" class:kept={f.kept}>
              {f.label} <span class="mono">{formatBytes(f.bytes)} · {f.kept ? 'kept' : 'removed'}</span>
            </li>
          {/each}
          {#if current.wroteOrientation}
            <li class="pill kept">Rotation tag <span class="mono">written back</span></li>
          {/if}
          {#if current.reencoded}
            <li class="pill">All metadata <span class="mono">removed by re-encoding</span></li>
          {/if}
        </ul>
      {/if}

      {#if clean}
        <p class="text-soft">No metadata found. This photo was already clean.</p>
      {/if}

      {#if current.summary.groups.length}
        <div class="grid gap-3 sm:grid-cols-2">
          {#each current.summary.groups as g (g.id)}
            <div class="card p-4">
              <h3 class="label">{g.title}</h3>
              <dl class="grid gap-1.5">
                {#each g.rows as [k, v] (k)}
                  <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 text-sm">
                    <dt class="text-muted">{k}</dt>
                    <dd class="break-words">{v}</dd>
                  </div>
                {/each}
              </dl>
            </div>
          {/each}
        </div>
      {/if}

      {#if current.summary.all.length}
        <details class="card overflow-hidden">
          <summary class="cursor-pointer px-4 py-3 text-sm">All {current.summary.all.length} tags</summary>
          <div class="max-h-96 overflow-auto border-t border-line">
            <table class="mono w-full">
              <tbody>
                {#each current.summary.all as [k, v] (k)}
                  <tr>
                    <th scope="row">{k}</th>
                    <td>{v}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </details>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .gps {
    padding: 18px;
    border: 1px solid color-mix(in srgb, var(--color-bad) 45%, transparent);
    border-radius: 18px;
    background: color-mix(in srgb, var(--color-bad) 7%, var(--color-panel));
  }
  .badge {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font: 500 13px var(--font-sans);
    color: var(--color-bad);
    background: color-mix(in srgb, var(--color-bad) 14%, transparent);
    padding: 5px 12px;
    border-radius: 999px;
  }
  .pill {
    font-size: 14px;
    padding: 6px 12px;
    border: 1px solid var(--color-line-2);
    border-radius: 999px;
    background: var(--color-panel);
    & .mono {
      color: var(--color-ok);
      margin-left: 4px;
    }
    &.kept .mono {
      color: var(--color-muted);
    }
  }
  table {
    border-collapse: collapse;
    & th,
    & td {
      text-align: left;
      vertical-align: top;
      padding: 7px 16px;
      border-bottom: 1px solid var(--color-line);
    }
    & th {
      font-weight: 400;
      color: var(--color-soft);
      white-space: nowrap;
    }
    & td {
      color: var(--color-chalk);
      word-break: break-word;
    }
  }
  .reading {
    color: var(--color-sun);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
</style>

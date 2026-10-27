<script lang="ts">
  import { onMount } from 'svelte';
  import QRCodeStyling from 'qr-code-styling';

  type Kind = 'url' | 'text' | 'wifi' | 'email' | 'phone' | 'contact';

  let kind = $state<Kind>('url');
  let url = $state('https://');
  let text = $state('');
  let wifi = $state({ ssid: '', password: '', security: 'WPA', hidden: false });
  let email = $state({ to: '', subject: '', body: '' });
  let phone = $state('');
  let contact = $state({ name: '', phone: '', email: '', org: '', url: '' });

  let fg = $state('#131211');
  let bg = $state('#ffffff');
  let dots = $state<'square' | 'rounded' | 'dots' | 'classy-rounded'>('rounded');
  let corners = $state<'square' | 'extra-rounded' | 'dot'>('extra-rounded');
  let logo = $state<string | undefined>(undefined);

  let holder: HTMLDivElement;
  let qr: QRCodeStyling | undefined;

  // Wi-Fi QR fields escape \ ; , : and "
  const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

  const data = $derived.by(() => {
    switch (kind) {
      case 'url': return url.trim();
      case 'text': return text;
      case 'wifi':
        return `WIFI:T:${wifi.security === 'none' ? 'nopass' : wifi.security};S:${esc(wifi.ssid)};${wifi.security === 'none' ? '' : `P:${esc(wifi.password)};`}${wifi.hidden ? 'H:true;' : ''};`;
      case 'email': {
        const q = new URLSearchParams();
        if (email.subject) q.set('subject', email.subject);
        if (email.body) q.set('body', email.body);
        const qs = q.toString().replace(/\+/g, '%20');
        return `mailto:${email.to}${qs ? `?${qs}` : ''}`;
      }
      case 'phone': return `tel:${phone.replace(/[^\d+]/g, '')}`;
      case 'contact':
        return [
          'BEGIN:VCARD', 'VERSION:3.0', `FN:${contact.name}`,
          contact.org && `ORG:${contact.org}`, contact.phone && `TEL:${contact.phone}`,
          contact.email && `EMAIL:${contact.email}`, contact.url && `URL:${contact.url}`, 'END:VCARD',
        ].filter(Boolean).join('\n');
    }
  });

  const empty = $derived(!data || data === 'https://' || data === 'tel:' || data === 'mailto:');

  const PREVIEW = 640;
  const EXPORT = 2048;

  const options = $derived({
    width: PREVIEW,
    height: PREVIEW,
    margin: 20,
    type: 'canvas' as const,
    data: empty ? 'https://roundertools.com' : data,
    image: logo,
    qrOptions: { errorCorrectionLevel: logo ? ('H' as const) : ('M' as const) },
    dotsOptions: { color: fg, type: dots },
    cornersSquareOptions: { color: fg, type: corners },
    cornersDotOptions: { color: fg, type: corners === 'square' ? ('square' as const) : ('dot' as const) },
    backgroundOptions: { color: bg },
    imageOptions: { margin: 12, imageSize: 0.32, hideBackgroundDots: true },
  });

  onMount(() => {
    qr = new QRCodeStyling(options);
    qr.append(holder);
  });

  // redraw once typing pauses rather than on every keystroke
  $effect(() => {
    const next = options;
    const t = setTimeout(() => qr?.update(next), 120);
    return () => clearTimeout(t);
  });

  async function download(extension: 'png' | 'svg') {
    if (!qr) return;
    // render a separate print-quality copy for the file; the preview stays small
    const big = new QRCodeStyling({ ...options, width: EXPORT, height: EXPORT, margin: 64, type: extension === 'svg' ? 'svg' : 'canvas' });
    await big.download({ name: 'qr-code', extension });
  }

  // a low-contrast code may not scan; warn using relative luminance
  function lum(hex: string) {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const contrast = $derived.by(() => {
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });

  function onLogo(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => (logo = reader.result as string);
    reader.readAsDataURL(f);
  }

  const kinds: [Kind, string][] = [['url', 'link'], ['text', 'text'], ['wifi', 'wi-fi'], ['email', 'email'], ['phone', 'phone'], ['contact', 'contact']];
</script>

<div class="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
  <div class="grid content-start gap-5">
    <div class="seg" role="group" aria-label="Content type">
      {#each kinds as [k, label]}
        <button type="button" aria-pressed={kind === k} onclick={() => (kind = k)}>{label}</button>
      {/each}
    </div>

    {#if kind === 'url'}
      <label><span class="label">link</span><input class="field" type="url" bind:value={url} /></label>
    {:else if kind === 'text'}
      <label><span class="label">text</span><textarea class="field min-h-[120px]! font-sans!" bind:value={text}></textarea></label>
    {:else if kind === 'wifi'}
      <div class="grid gap-3 sm:grid-cols-2">
        <label><span class="label">network name (SSID)</span><input class="field" bind:value={wifi.ssid} /></label>
        <label><span class="label">password</span><input class="field" bind:value={wifi.password} disabled={wifi.security === 'none'} /></label>
        <label><span class="label">security</span>
          <select class="field" bind:value={wifi.security}><option value="WPA">WPA / WPA2 / WPA3</option><option value="WEP">WEP</option><option value="none">none</option></select>
        </label>
        <label class="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" bind:checked={wifi.hidden} /> hidden network</label>
      </div>
    {:else if kind === 'email'}
      <div class="grid gap-3">
        <label><span class="label">to</span><input class="field" type="email" bind:value={email.to} /></label>
        <label><span class="label">subject</span><input class="field" bind:value={email.subject} /></label>
        <label><span class="label">message</span><textarea class="field min-h-[100px]! font-sans!" bind:value={email.body}></textarea></label>
      </div>
    {:else if kind === 'phone'}
      <label><span class="label">phone number</span><input class="field" type="tel" bind:value={phone} placeholder="+1 555 123 4567" /></label>
    {:else}
      <div class="grid gap-3 sm:grid-cols-2">
        <label><span class="label">name</span><input class="field" bind:value={contact.name} /></label>
        <label><span class="label">company</span><input class="field" bind:value={contact.org} /></label>
        <label><span class="label">phone</span><input class="field" type="tel" bind:value={contact.phone} /></label>
        <label><span class="label">email</span><input class="field" type="email" bind:value={contact.email} /></label>
        <label class="sm:col-span-2"><span class="label">website</span><input class="field" type="url" bind:value={contact.url} /></label>
      </div>
    {/if}

    <div class="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
      <div>
        <span class="label">dots</span>
        <div class="seg" role="group" aria-label="Dot style">
          {#each ['square', 'rounded', 'dots', 'classy-rounded'] as const as d}
            <button type="button" aria-pressed={dots === d} onclick={() => (dots = d)}>{d.replace('classy-', '')}</button>
          {/each}
        </div>
      </div>
      <div>
        <span class="label">corners</span>
        <div class="seg" role="group" aria-label="Corner style">
          {#each [['square', 'square'], ['extra-rounded', 'round'], ['dot', 'dot']] as const as [c, label]}
            <button type="button" aria-pressed={corners === c} onclick={() => (corners = c)}>{label}</button>
          {/each}
        </div>
      </div>
      <label class="flex items-center gap-3"><input type="color" bind:value={fg} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" /> <span class="mono">code {fg}</span></label>
      <label class="flex items-center gap-3"><input type="color" bind:value={bg} class="h-10 w-12 cursor-pointer rounded-lg border border-line-2 bg-transparent" /> <span class="mono">background {bg}</span></label>
      <div class="sm:col-span-2 flex flex-wrap items-center gap-3">
        <label class="btn cursor-pointer">{logo ? 'Change logo' : 'Add a logo'}<input type="file" accept="image/*" class="hidden" onchange={onLogo} /></label>
        {#if logo}<button type="button" class="btn" onclick={() => (logo = undefined)}>Remove logo</button>{/if}
      </div>
    </div>
  </div>

  <div class="grid content-start gap-4">
    <div class="qr overflow-hidden rounded-2xl border border-line-2" bind:this={holder} class:dim={empty}></div>
    {#if empty}<p class="mono -mt-2">fill in the details to make your code</p>{/if}
    {#if contrast < 3}<p class="text-bad text-sm" role="alert">Low contrast between the code and background. Many phones won't scan it.</p>{/if}
    <div class="grid grid-cols-2 gap-2">
      <button type="button" class="btn btn-primary" disabled={empty} onclick={() => download('png')}>Download PNG</button>
      <button type="button" class="btn" disabled={empty} onclick={() => download('svg')}>Download SVG</button>
    </div>
    <p class="mono">static code · scans forever · no tracking redirect</p>
  </div>
</div>

<style>
  .qr :global(canvas) {
    display: block;
    width: 100%;
    height: auto;
  }
  .qr.dim {
    opacity: 0.25;
  }
</style>

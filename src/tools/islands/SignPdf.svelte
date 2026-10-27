<script lang="ts">
  import { onMount } from 'svelte';
  import PdfDrop, { type OpenedPdf } from '@/components/tool/PdfDrop.svelte';
  import OverlayEditor from '@/tools/lib/pdf-overlay/OverlayEditor.svelte';

  let opened = $state.raw<OpenedPdf | null>(null);

  function reset() {
    void opened?.doc.destroy();
    opened = null;
  }

  onMount(() => () => void opened?.doc.destroy());
</script>

{#if opened}
  {#key opened.doc.id}
    <OverlayEditor
      file={opened.file}
      doc={opened.doc}
      password={opened.password}
      tools={['select', 'signature', 'initials', 'name', 'date', 'text', 'check', 'cross']}
      suffix="-signed"
      saveLabel="Download signed PDF"
      onreset={reset}
    >
      {#snippet note()}
        Your signature is added as an image: a simple electronic signature, not a certificate-based digital signature.
      {/snippet}
    </OverlayEditor>
  {/key}
{:else}
  <PdfDrop title="Drop a PDF to sign" onopen={(pdf) => (opened = pdf)} />
  <ul class="perks mono">
    <li>draw, type or upload your signature</li>
    <li>initials, name, date and check marks</li>
    <li>no account, no watermark</li>
  </ul>
{/if}

<style>
  .perks {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 22px;
    margin-top: 14px;
    & li::before {
      content: '✦ ';
      color: var(--color-sun);
    }
  }
</style>

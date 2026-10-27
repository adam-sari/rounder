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
      tools={['select', 'text', 'image', 'signature', 'whiteout', 'highlight', 'rect', 'ellipse', 'line', 'arrow', 'ink', 'check', 'cross', 'date']}
      suffix="-edited"
      saveLabel="Download edited PDF"
      onreset={reset}
    >
      {#snippet note()}
        New content goes on top of the page. To change existing text, cover it with whiteout and type over it.
      {/snippet}
    </OverlayEditor>
  {/key}
{:else}
  <PdfDrop title="Drop a PDF to edit" onopen={(pdf) => (opened = pdf)} />
  <ul class="perks mono">
    <li>text, images and signatures</li>
    <li>whiteout, highlights, shapes and arrows</li>
    <li>original pages stay sharp</li>
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

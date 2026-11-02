<script lang="ts">
  import CopyButton from '@/components/tool/CopyButton.svelte';
  import type { SnippetKind } from '@/developers/installer';

  // CodeBlock.astro's look, for code that changes as the installer's options do: the copy button reads the current text.
  // One-line commands wrap, so a phone shows all of one; JSON, TOML and code keep their lines and scroll.
  let { code, label, name, kind }: { code: string; label: string; name: string; kind: SnippetKind } = $props();
  const wrap = $derived(kind === 'shell' || kind === 'claude');
  // a wrapped command breaks only at its spaces, never at a hyphen inside a word (adam-sari/rounder)
  const parts = $derived(code.split(/(\s+)/).filter(Boolean));
</script>

<figure class="code-block card">
  <figcaption class="mono">{label}</figcaption>
  <pre class:wrapped={wrap}><code>{#if wrap}{#each parts as part}{#if /^\s/.test(part)}{part}{:else}<span class="word">{part}</span>{/if}{/each}{:else}{code}{/if}</code></pre>
  <CopyButton text={() => code} name={name} class="copy" />
</figure>

<style>
  .code-block {
    position: relative;
    margin: 10px 0 14px;
    padding: 14px 16px;
    /* a flex or grid child: let long lines scroll inside the box instead of widening the page */
    min-width: 0;
  }
  /* clear of the copy button, like the code under it */
  figcaption {
    margin-bottom: 6px;
    padding-right: 72px;
    overflow-wrap: anywhere;
  }
  pre {
    margin: 0;
    padding-right: 72px;
    overflow-x: auto;
    font: 400 13.5px/1.6 var(--font-mono);
    color: var(--color-chalk);
    white-space: pre;
    &.wrapped {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    /* one box per word: lines break between words, and only a word wider than the box breaks inside */
    .word {
      display: inline-block;
      max-width: 100%;
    }
  }
  /* the button is CopyButton's own element, so the scoped rule has to reach into it */
  figure :global(.copy) {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 4px 10px;
    font-size: 13px;
  }
</style>

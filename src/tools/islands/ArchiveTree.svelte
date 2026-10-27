<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { formatBytes } from '@/tools/lib/files';
  import { previewKind } from '@/tools/lib/unzip/formats';
  import { initialExpanded, visibleRows, type Tree, type TreeNode } from '@/tools/lib/unzip/tree';

  interface Props {
    tree: Tree<T>;
    label: string;
    /** shows matching files as a flat list */
    query?: string;
    /** the highlighted file */
    active?: TreeNode<T> | null;
    /** clicking a file's name */
    onopen?: (node: TreeNode<T>) => void;
    /** before the name, e.g. a checkbox */
    lead?: Snippet<[TreeNode<T>]>;
    /** after the size, e.g. buttons */
    trail?: Snippet<[TreeNode<T>]>;
  }

  let { tree, label, query = '', active = null, onopen, lead, trail }: Props = $props();

  // long folders render in pages so a 50k-file archive doesn't build 50k rows at once
  const PAGE = 500;
  let limit = $state(PAGE);
  const expanded = new SvelteSet<string>();

  // open the lone top folder of each new tree (and of folders added later)
  $effect(() => {
    for (const path of initialExpanded(tree.root)) expanded.add(path);
  });
  $effect(() => {
    void query;
    limit = PAGE;
  });

  const rows = $derived(visibleRows(tree.root, expanded, query));

  function toggle(node: TreeNode<T>) {
    if (expanded.has(node.path)) expanded.delete(node.path);
    else expanded.add(node.path);
  }

  const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

  function tint(name: string) {
    const kind = previewKind(name);
    if (kind === 'image') return 'var(--color-image)';
    if (kind === 'video') return 'var(--color-video)';
    if (kind === 'audio') return 'var(--color-audio)';
    if (kind === 'text') return 'var(--color-text)';
    if (/\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst)$/i.test(name)) return 'var(--color-files)';
    return 'var(--color-muted)';
  }
</script>

<ul class="tree" aria-label={label}>
  {#each rows.slice(0, limit) as node (node.dir ? `${node.path}/` : node.path)}
    <li class="row" class:active={node === active} style:--depth={query ? 0 : node.depth}>
      {@render lead?.(node)}
      {#if node.dir}
        <button type="button" class="name" aria-expanded={expanded.has(node.path)} onclick={() => toggle(node)}>
          <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
          <svg class="icon" viewBox="0 0 20 20" aria-hidden="true" style:color="var(--color-sun)">
            <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.8 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" />
          </svg>
          <span class="truncate">{node.name}</span>
          <span class="mono count">{node.count}</span>
        </button>
      {:else}
        {@const inner = query ? parent(node.path) : ''}
        {#snippet fileName()}
          <svg class="icon" viewBox="0 0 20 20" aria-hidden="true" style:color={tint(node.name)}>
            <path d="M5 2.5h6.5l3.5 3.5v10A1.5 1.5 0 0 1 13.5 17.5h-8.5A1.5 1.5 0 0 1 3.5 16V4A1.5 1.5 0 0 1 5 2.5z" /><path d="M11.5 2.5V6H15" />
          </svg>
          <span class="min-w-0 truncate">
            {node.name}{#if inner}<span class="mono where">{inner}/</span>{/if}
          </span>
        {/snippet}
        {#if onopen}
          <button type="button" class="name" aria-current={node === active ? 'true' : undefined} onclick={() => onopen(node)}>{@render fileName()}</button>
        {:else}
          <span class="name">{@render fileName()}</span>
        {/if}
      {/if}
      <span class="mono size">{formatBytes(node.size)}</span>
      {@render trail?.(node)}
    </li>
  {/each}
</ul>

{#if rows.length > limit}
  <button type="button" class="btn more" onclick={() => (limit += PAGE)}>
    Show {Math.min(PAGE, rows.length - limit).toLocaleString()} more <span class="mono">of {(rows.length - limit).toLocaleString()} left</span>
  </button>
{:else if !rows.length && query.trim()}
  <p class="mono empty">No files match “{query.trim()}”.</p>
{/if}

<style>
  .tree {
    display: grid;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 2px 6px 2px calc(6px + min(var(--depth), 8) * 10px);
    border-radius: 10px;
    @media (min-width: 640px) {
      padding-left: calc(6px + min(var(--depth), 8) * 18px);
    }
    animation: rise 0.18s ease-out both;
    &:hover {
      background: #f2ede40a;
    }
    &.active {
      background: #ffd25e14;
      box-shadow: inset 0 0 0 1px #ffd25e66;
    }
  }
  .name {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 6px 0;
    font: 400 14px/1.3 var(--font-sans);
    color: var(--color-chalk);
    text-align: left;
    background: none;
    border: 0;
  }
  button.name {
    cursor: pointer;
  }
  .chev {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--color-muted);
    stroke-width: 1.6;
    transition: transform 0.2s var(--ease-spring);
  }
  [aria-expanded='true'] .chev {
    transform: rotate(90deg);
  }
  .icon {
    flex: none;
    width: 18px;
    height: 18px;
    fill: color-mix(in srgb, currentColor 14%, transparent);
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linejoin: round;
  }
  .count {
    flex: none;
    padding: 0 6px;
    border: 1px solid var(--color-line);
    border-radius: 99px;
    font-size: 11px;
  }
  .where {
    display: block;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .size {
    flex: none;
    font-size: 12px;
    text-align: right;
  }
  .more {
    width: 100%;
    margin-top: 8px;
  }
  .empty {
    padding: 24px 8px;
    text-align: center;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
</style>

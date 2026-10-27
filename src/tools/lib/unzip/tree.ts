import { withSuffix } from '../files';
import { normalizePath } from './formats';

export interface TreeNode<T> {
  name: string;
  /** slash-separated path from the top, without a trailing slash */
  path: string;
  dir: boolean;
  /** bytes; the total of everything inside for folders */
  size: number;
  /** files inside (1 for a file) */
  count: number;
  depth: number;
  children: TreeNode<T>[];
  /** files inside are files[first..end) in display order; a file's own index is `first` */
  first: number;
  end: number;
  item?: T;
}

export interface Tree<T> {
  root: TreeNode<T>;
  /** every file, in the order the tree shows them */
  files: TreeNode<T>[];
  folders: number;
}

const node = <T>(name: string, path: string, dir: boolean, depth: number, size = 0, item?: T): TreeNode<T> => ({
  name, path, dir, size, count: dir ? 0 : 1, depth, children: [], first: 0, end: 0, item,
});

/** Builds a sorted folder tree (folders first, natural order) from flat paths */
export function buildTree<T extends { path: string; size: number }>(items: T[]): Tree<T> {
  const root = node<T>('', '', true, -1);
  const dirs = new Map<string, TreeNode<T>>([['', root]]);
  const taken = new Set<string>();

  for (const item of items) {
    const parts = normalizePath(item.path).split('/').filter(Boolean);
    if (!parts.length) continue;
    let parent = root;
    for (let d = 0; d < parts.length - 1; d++) {
      const path = parts.slice(0, d + 1).join('/');
      let dir = dirs.get(path);
      if (!dir) {
        dir = node<T>(parts[d], path, true, d);
        dirs.set(path, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    // two entries with one name (tar allows it) stay apart as "name (2)"
    const folder = parts.slice(0, -1).join('/');
    let name = parts[parts.length - 1];
    for (let n = 2; taken.has(folder ? `${folder}/${name}` : name); n++) name = withSuffix(parts[parts.length - 1], ` (${n})`);
    const path = folder ? `${folder}/${name}` : name;
    taken.add(path);
    parent.children.push(node(name, path, false, parts.length - 1, item.size, item));
  }

  const files: TreeNode<T>[] = [];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const walk = (dir: TreeNode<T>) => {
    dir.children.sort((a, b) => (a.dir === b.dir ? collator.compare(a.name, b.name) : a.dir ? -1 : 1));
    dir.first = files.length;
    for (const child of dir.children) {
      if (child.dir) {
        walk(child);
        dir.size += child.size;
      } else {
        child.first = files.length;
        child.end = child.first + 1;
        files.push(child);
        dir.size += child.size;
      }
    }
    dir.end = files.length;
    dir.count = dir.end - dir.first;
  };
  walk(root);
  return { root, files, folders: dirs.size - 1 };
}

/** The rows to show: open folders' contents, or every file matching a search */
export function visibleRows<T>(root: TreeNode<T>, expanded: ReadonlySet<string>, query = ''): TreeNode<T>[] {
  const rows: TreeNode<T>[] = [];
  const q = query.trim().toLowerCase();
  const walk = (dir: TreeNode<T>) => {
    for (const child of dir.children) {
      if (q) {
        if (child.dir) walk(child);
        else if (child.path.toLowerCase().includes(q)) rows.push(child);
      } else {
        rows.push(child);
        if (child.dir && expanded.has(child.path)) walk(child);
      }
    }
  };
  walk(root);
  return rows;
}

/** Folders to open at first: a lone top folder (and any lone folder inside it), so files show straight away */
export function initialExpanded<T>(root: TreeNode<T>): string[] {
  const open: string[] = [];
  let dir = root;
  while (dir.children.length === 1 && dir.children[0].dir) {
    dir = dir.children[0];
    open.push(dir.path);
  }
  return open;
}

/** running totals so "how many selected in this folder" is one subtraction */
export function prefixSums(flags: Uint8Array) {
  const sums = new Uint32Array(flags.length + 1);
  for (let i = 0; i < flags.length; i++) sums[i + 1] = sums[i] + flags[i];
  return sums;
}

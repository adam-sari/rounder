export interface PickedFile {
  file: File;
  /** path inside the archive, e.g. "photos/2024/beach.jpg" */
  path: string;
}

/**
 * Files from a drop, folders included. The entries have to be taken from the event
 * straight away (before any await), so call this synchronously in the drop handler.
 */
export function droppedFiles(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.() ?? null);
  if (!entries.length || entries.some((e) => !e)) {
    return Promise.resolve([...dt.files].map((file) => ({ file, path: file.name })));
  }
  return (async () => {
    const out: PickedFile[] = [];
    for (const entry of entries) await walk(entry!, '', out);
    return out;
  })();
}

async function walk(entry: FileSystemEntry, prefix: string, out: PickedFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, path: prefix + entry.name });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries hands back folders in batches (about 100 at a time in Chrome)
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out);
    }
  }
}

/** files from an <input webkitdirectory>, which carry their folder in webkitRelativePath */
export const inputFiles = (list: FileList | null): PickedFile[] =>
  [...(list ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

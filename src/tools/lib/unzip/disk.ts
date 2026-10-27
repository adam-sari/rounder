import { safeSegments } from './formats';

type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;

/** the File System Access folder picker (Chrome, Edge, Opera on desktop), if this browser has it */
export function folderPicker(): DirectoryPicker | undefined {
  const pick = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return pick?.bind(window);
}

/**
 * Writes files into a folder the person picked, creating subfolders as needed.
 * Paths are cleaned first, so an archive can never write outside that folder.
 * Returns how many files couldn't be written.
 */
export async function writeToFolder(
  root: FileSystemDirectoryHandle,
  files: { path: string; blob: Blob }[],
  onProgress: (written: number) => void,
) {
  const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>([['', Promise.resolve(root)]]);
  const dirFor = (parts: string[]): Promise<FileSystemDirectoryHandle> => {
    const key = parts.join('/');
    let dir = dirs.get(key);
    if (!dir) {
      dir = dirFor(parts.slice(0, -1)).then((parent) => parent.getDirectoryHandle(parts[parts.length - 1], { create: true }));
      dirs.set(key, dir);
    }
    return dir;
  };

  let failed = 0;
  for (const [i, f] of files.entries()) {
    const parts = safeSegments(f.path);
    let out: FileSystemWritableFileStream | undefined;
    try {
      if (!parts) throw new Error('no usable name');
      const dir = await dirFor(parts.slice(0, -1));
      const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      out = await handle.createWritable();
      await out.write(f.blob);
      await out.close();
    } catch (e) {
      // drops the half-written temp file instead of leaving it in their folder
      await out?.abort().catch(() => {});
      // a lost permission stops everything; a single odd name shouldn't
      if ((e as Error)?.name === 'NotAllowedError') throw e;
      console.error(e);
      failed++;
    }
    onProgress(i + 1);
  }
  return failed;
}

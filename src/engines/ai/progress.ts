/** What loaders report: bytes while downloading, then a short "init" while the model is set up */
export interface LoadProgress {
  phase: 'download' | 'init';
  loaded: number;
  total: number;
  /** the file being fetched, for the curious */
  file?: string;
}

export type OnProgress = (p: LoadProgress) => void;

/**
 * Adds up byte progress across many files into one stable "MB of MB". Totals come from the
 * registry up front (so the bar doesn't jump when the next file starts), and grow if a file
 * turns out bigger or wasn't listed.
 */
export class ProgressTally {
  private files = new Map<string, { loaded: number; total: number }>();

  constructor(expected: Record<string, number> = {}) {
    for (const [file, total] of Object.entries(expected)) this.files.set(file, { loaded: 0, total });
  }

  /** Records a file's progress; total is optional when the registry already knows it */
  update(file: string, loaded: number, total?: number): LoadProgress {
    const entry = this.files.get(file) ?? { loaded: 0, total: 0 };
    entry.total = Math.max(entry.total, total ?? 0, loaded);
    entry.loaded = Math.min(Math.max(entry.loaded, loaded), entry.total);
    this.files.set(file, entry);
    return { ...this.sum(), file };
  }

  /** Marks a file as fully loaded (e.g. read from the cache without byte events) */
  done(file: string): LoadProgress {
    const entry = this.files.get(file);
    return this.update(file, entry?.total ?? 0, entry?.total);
  }

  sum(): LoadProgress {
    let loaded = 0;
    let total = 0;
    for (const f of this.files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    return { phase: 'download', loaded, total };
  }
}

/** Limits progress callbacks to ~20 a second (each one may be a postMessage); the last report always goes through */
export function throttleProgress(fn: OnProgress, ms = 50): OnProgress {
  let last = 0;
  return (p) => {
    const now = performance.now();
    if (p.phase === 'init' || p.loaded >= p.total || now - last >= ms) {
      last = now;
      fn(p);
    }
  };
}

/**
 * Decimal megabytes, as Hugging Face shows them, so page copy and model cards agree:
 * 114538221 → "115 MB", 6632188 → "6.6 MB", 1085000000 → "1.1 GB"
 */
export function formatMB(bytes: number): string {
  const mb = bytes / 1e6;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb >= 10 ? Math.round(mb) : Math.max(0.1, Math.round(mb * 10) / 10)} MB`;
}

/** "32 of 115 MB" */
export function formatProgress({ loaded, total }: LoadProgress): string {
  return total >= 1e9 ? `${(loaded / 1e9).toFixed(2)} of ${formatMB(total)}` : `${Math.round(loaded / 1e6)} of ${formatMB(total)}`;
}

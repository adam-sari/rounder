import type { Peaks } from '@/engines/media/types';

/*
 * Keeps recordings in this browser's IndexedDB while they are made (a chunk a second), so a
 * reload, a crash or a closed tab doesn't lose them. Browser-only; nothing leaves the device.
 */

export interface StoredMeta {
  id: string;
  name: string;
  /** the recorder's MIME type */
  mime: string;
  createdAt: number;
  /** last write: the heartbeat that tells a live recording from an interrupted one without Web Locks */
  updatedAt: number;
  durationSec: number;
  finished: boolean;
  /** the stored file is the seekable copy, so a restore can skip remuxing and measuring it */
  ready?: boolean;
  sampleRate?: number;
  channels?: number;
  peaks?: Peaks | null;
}

const DB_NAME = 'rounder-voice-recorder';

/** held (Web Locks) by the tab that is making a recording; released when it stops or the tab goes away */
export const lockName = (id: string) => `${DB_NAME}:${id}`;

/** ids of recordings some open tab is still making, or null when the browser lacks Web Locks */
export async function liveRecordingIds(): Promise<Set<string> | null> {
  if (typeof navigator === 'undefined' || !navigator.locks?.query) return null;
  try {
    const { held = [] } = await navigator.locks.query();
    const prefix = lockName('');
    return new Set(held.flatMap((l) => (l.name?.startsWith(prefix) ? [l.name.slice(prefix.length)] : [])));
  } catch {
    return null;
  }
}

/**
 * An unfinished recording is still being made elsewhere when its tab holds the lock. Without
 * Web Locks, fall back to the heartbeat: a chunk is written every second while it records.
 */
export const isLiveElsewhere = (meta: Pick<StoredMeta, 'id' | 'finished' | 'updatedAt'>, live: Set<string> | null, now: number) =>
  !meta.finished && (live ? live.has(meta.id) : now - meta.updatedAt < 5000);

const ask = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const commit = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

const chunksOf = (id: string) => IDBKeyRange.bound([id, 0], [id, Infinity]);

export class RecordingStore {
  private constructor(private db: IDBDatabase) {}

  /** null when IndexedDB is missing or blocked (some private windows) */
  static async open(): Promise<RecordingStore | null> {
    if (typeof indexedDB === 'undefined') return null;
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('recordings', { keyPath: 'id' });
        r.result.createObjectStore('chunks', { keyPath: ['rec', 'seq'] });
      };
      return new RecordingStore(await ask(r));
    } catch {
      return null;
    }
  }

  save(meta: StoredMeta) {
    const tx = this.db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').put(meta);
    return commit(tx);
  }

  /** one chunk plus the meta's heartbeat, in one transaction */
  addChunk(meta: StoredMeta, seq: number, blob: Blob) {
    const tx = this.db.transaction(['recordings', 'chunks'], 'readwrite');
    tx.objectStore('chunks').put({ rec: meta.id, seq, blob });
    tx.objectStore('recordings').put({ ...meta, updatedAt: Date.now() });
    return commit(tx);
  }

  /** swaps the raw chunks for the finished, seekable file */
  replace(meta: StoredMeta, blob: Blob) {
    const tx = this.db.transaction(['recordings', 'chunks'], 'readwrite');
    const chunks = tx.objectStore('chunks');
    chunks.delete(chunksOf(meta.id));
    chunks.put({ rec: meta.id, seq: 0, blob });
    tx.objectStore('recordings').put(meta);
    return commit(tx);
  }

  /** every stored recording with its chunks joined back into one file, oldest first */
  async list(live: Set<string> | null): Promise<{ meta: StoredMeta; blob: Blob }[]> {
    const metas = await ask<StoredMeta[]>(this.db.transaction('recordings').objectStore('recordings').getAll());
    const out: { meta: StoredMeta; blob: Blob }[] = [];
    for (const meta of metas.sort((a, b) => a.createdAt - b.createdAt)) {
      const rows = await ask<{ blob: Blob }[]>(this.db.transaction('chunks').objectStore('chunks').getAll(chunksOf(meta.id)));
      if (rows.length) out.push({ meta, blob: new Blob(rows.map((r) => r.blob), { type: meta.mime }) });
      else if (!isLiveElsewhere(meta, live, Date.now())) void this.remove(meta.id);
    }
    return out;
  }

  remove(id: string) {
    const tx = this.db.transaction(['recordings', 'chunks'], 'readwrite');
    tx.objectStore('recordings').delete(id);
    tx.objectStore('chunks').delete(chunksOf(id));
    return commit(tx);
  }
}

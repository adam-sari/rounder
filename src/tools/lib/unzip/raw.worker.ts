import * as Comlink from 'comlink';
import { Gunzip } from 'fflate';
import { bunzip2 } from './bzip2';
import type { StreamFormat } from './formats';
import { unxz } from './xz';

const api = {
  /** unpacks a single .gz, .bz2 or .xz file */
  async decompress(file: Blob, format: StreamFormat, onProgress: (bytesRead: number) => void): Promise<Blob> {
    // each piece becomes a Blob straight away: the decoders reuse their buffers, and the browser can page Blobs to disk
    const parts: Blob[] = [];
    const keep = (chunk: Uint8Array) => parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
    let reported = 0;
    const progress = (read: number) => {
      if (read - reported > 1 << 20) onProgress((reported = read));
    };

    if (format === 'gz') {
      // gzip streams, so even huge files never have to fit in memory at once
      const gz = new Gunzip(keep);
      const reader = file.stream().getReader();
      let read = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        gz.push(value);
        progress((read += value.length));
      }
      gz.push(new Uint8Array(0), true);
    } else {
      const input = new Uint8Array(await file.arrayBuffer());
      (format === 'bz2' ? bunzip2 : unxz)(input, keep, progress);
    }
    return new Blob(parts);
  },
};

export type RawWorker = typeof api;
Comlink.expose(api);

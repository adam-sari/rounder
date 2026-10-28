import type { FileOutput } from './output';
import type { Source } from './io';

export interface Progress {
  stage: string;
  done?: number;
  total?: number;
  /** 0–1 */
  ratio?: number;
  note?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?(p: Progress): void;
}

/** what an op implementation gets besides its inputs and options */
export interface Ctx {
  signal: AbortSignal;
  progress(p: Progress): void;
}

/** what an op implementation hands back */
export interface OpResult {
  files: FileOutput[];
  text?: string;
  data?: Record<string, unknown>;
  warnings: string[];
}

export type Impl = (inputs: Source[], options: never, ctx: Ctx) => Promise<OpResult>;

export const result = (r: Partial<OpResult>): OpResult => ({ files: [], warnings: [], ...r });

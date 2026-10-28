import type { OpSpec } from '../core/op';
import { fileOps } from './files';
import { imageOps } from './image';
import { mediaOps } from './media';
import { pdfOps } from './pdf';

export * from './files';
export * from './image';
export * from './media';
export * from './pdf';

/** Every op, in a stable order: the order of `roundertools list` and of the MCP tool list */
export const ops: readonly OpSpec[] = [...pdfOps, ...imageOps, ...fileOps, ...mediaOps];

export const opBySlug: Readonly<Record<string, OpSpec>> = Object.fromEntries(ops.map((o) => [o.slug, o]));

/** ops that aren't a page on the site */
export const SITELESS = new Set(['file-info']);

import './platform/node/imagedata';
import type { FileInput } from './core/io';
import type { OpSpec, OptionsIn } from './core/op';
import type { FileOutput } from './core/output';
import type { RunOptions } from './core/run';
import * as op from './ops/index';
import { run } from './run';

export { RounderError, isRounderError, type ErrorCode } from './core/errors';
export { FileOutput, type SaveOptions } from './core/output';
export { toSource, type FileInput, type Source } from './core/io';
export { parseSize, formatSize } from './core/size';
export type { OpSpec, OptionsIn, OptionsOut, Family, Returns, Example } from './core/op';
export type { Progress, RunOptions, OpResult } from './core/run';
export { ops, opBySlug } from './ops/index';
export { snippets, cliLine, sdkSnippet, kebab } from './ops/docs';
export { run, describe, resolveTool, unknownTool, parseOptions, webLink, checkRequirements, type ResolvedTool } from './run';
export { catalog, SITE, type CatalogEntry } from './catalog';
export { findFfmpeg, ffmpegVersion } from './platform/node/ffmpeg-bin';
export { loadCanvas } from './platform/node/canvas';
declare const __VERSION__: string;
/** this package's version */
export const version: string = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev';

/* Typed functions, one per op, generated from the op specs: pdf.compress(file, { target: '1mb' }) and so on. */

type Opts<S extends OpSpec> = OptionsIn<S>;

const one =
  <S extends OpSpec>(spec: S) =>
  async (file: FileInput, options?: Opts<S>, o?: RunOptions): Promise<FileOutput> =>
    (await run(spec.slug, [file], options as Record<string, unknown>, o)).files[0];
const fromMany =
  <S extends OpSpec>(spec: S) =>
  async (files: FileInput[], options?: Opts<S>, o?: RunOptions): Promise<FileOutput> =>
    (await run(spec.slug, files, options as Record<string, unknown>, o)).files[0];
const many =
  <S extends OpSpec>(spec: S) =>
  async (file: FileInput, options?: Opts<S>, o?: RunOptions): Promise<FileOutput[]> =>
    (await run(spec.slug, [file], options as Record<string, unknown>, o)).files;
const text =
  <S extends OpSpec>(spec: S) =>
  async (file: FileInput, options?: Opts<S>, o?: RunOptions): Promise<string> =>
    (await run(spec.slug, [file], options as Record<string, unknown>, o)).text ?? '';
const data =
  <S extends OpSpec>(spec: S) =>
  async (file: FileInput, options?: Opts<S>, o?: RunOptions): Promise<Record<string, unknown>> =>
    (await run(spec.slug, [file], options as Record<string, unknown>, o)).data ?? {};

export const pdf = {
  merge: fromMany(op.mergePdf),
  split: many(op.splitPdf),
  compress: one(op.compressPdf),
  protect: one(op.protectPdf),
  unlock: one(op.unlockPdf),
  organize: one(op.organizePdf),
  addPageNumbers: one(op.addPageNumbers),
  watermark: one(op.watermarkPdf),
  fromImages: fromMany(op.jpgToPdf),
  toText: text(op.pdfToText),
  toImages: many(op.pdfToJpg),
  extractImages: many(op.extractImages),
};

export const image = {
  convert: one(op.imageConverter),
  compress: one(op.imageCompressor),
  resize: one(op.imageResizer),
  crop: one(op.cropImage),
  rotate: one(op.rotateImage),
  stripMetadata: one(op.exifRemover),
};

export const files = {
  zip: fromMany(op.zipFiles),
  unzip: many(op.unzipFiles),
  checksum: data(op.checksum),
  info: data(op.fileInfo),
};

/** needs the user's own ffmpeg (on PATH or ROUNDERTOOLS_FFMPEG) */
export const media = {
  compress: one(op.videoCompressor),
  convert: one(op.videoConverter),
  trim: one(op.trimVideo),
  mute: one(op.muteVideo),
  toGif: one(op.videoToGif),
  toAudio: one(op.videoToMp3),
  convertAudio: one(op.audioConverter),
};

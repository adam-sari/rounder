import { imageKind } from '@/engines/image/kind';
import { RounderError } from '../core/errors';
import type { Source } from '../core/io';
import { result, type Ctx, type Impl, type OpResult } from '../core/run';
import { findFfmpeg } from '../platform/node/ffmpeg-bin';
import * as files from './files';
import * as image from './image';
import * as media from './media';
import * as pdf from './pdf';

async function fileInfo(inputs: Source[], o: { password?: string }, _ctx: Ctx): Promise<OpResult> {
  const [src] = inputs;
  const head = (await src.bytes()).subarray(0, 1024);
  const base = { file: src.name, path: src.path, size: src.size };
  if (new TextDecoder('latin1').decode(head).includes('%PDF-')) return result({ data: { ...base, ...(await pdf.info(src, o.password)) } });
  const kind = await imageKind(Object.assign(new Blob([head.subarray(0, 64) as Uint8Array<ArrayBuffer>]), { name: src.name }));
  if (kind !== 'unknown') return result({ data: { ...base, ...(await image.info(src)) } });
  if (findFfmpeg()) {
    try {
      return result({ data: { ...base, ...(await media.info(src)) } });
    } catch (e) {
      if (!(e instanceof RounderError) || e.code !== 'unsupported-input') throw e;
    }
  }
  return result({ data: { ...base, kind: 'unknown' }, warnings: findFfmpeg() ? [] : ['Install ffmpeg to get details of video and audio files.'] });
}

/** slug → implementation; ops/index.ts holds the specs */
export const impls: Record<string, Impl> = {
  'merge-pdf': pdf.merge,
  'split-pdf': pdf.split,
  'compress-pdf': pdf.compress,
  'protect-pdf': pdf.protect,
  'unlock-pdf': pdf.unlock,
  'organize-pdf': pdf.organize,
  'add-page-numbers-to-pdf': pdf.numbers,
  'watermark-pdf': pdf.watermark,
  'jpg-to-pdf': pdf.fromImages,
  'pdf-to-text': pdf.toTextOp,
  'pdf-to-jpg': pdf.toImages,
  'extract-images-from-pdf': pdf.extractImagesOp,
  'image-converter': image.convert,
  'image-compressor': image.compress,
  'image-resizer': image.resizeOp,
  'crop-image': image.crop,
  'rotate-image': image.rotate,
  'exif-remover': image.strip,
  'zip-files': files.zip,
  'unzip-files': files.unzip,
  'checksum-calculator': files.checksum,
  'file-info': fileInfo,
  'video-compressor': media.compress,
  'video-converter': media.convert,
  'trim-video': media.trim,
  'mute-video': media.mute,
  'video-to-gif': media.toGif,
  'video-to-mp3': media.toAudio,
  'audio-converter': media.convertAudio,
} as unknown as Record<string, Impl>;

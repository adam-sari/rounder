import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Output, QUALITY_HIGH, VideoSample, WebMOutputFormat } from 'mediabunny';
import { MediaError, toMediaError, type JobControl, type TranscodeResult } from '@/engines/media';
import type { BgSettings, Compositor } from './compositor';

/**
 * WebM with VP9 + alpha (mediabunny encodes the alpha plane alongside the colour). The shared
 * media engine paints frames onto black and drops alpha, so transparent output takes this path.
 * The finished file is held in memory, which is fine for the clip lengths this tool is for.
 */
export async function exportTransparent(
  file: Blob,
  size: { width: number; height: number },
  compositor: Compositor,
  settings: BgSettings,
  ctl: JobControl = {},
): Promise<TranscodeResult> {
  const { width, height } = size;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  let conversion: Conversion | null = null;
  const cancel = () => void conversion?.cancel();
  ctl.signal?.addEventListener('abort', cancel);
  try {
    compositor.reset();
    conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      showWarnings: false,
      video: {
        codec: 'vp9',
        alpha: 'keep',
        quality: QUALITY_HIGH,
        forceTranscode: true,
        allowTransformationMetadata: false,
        processedWidth: width,
        processedHeight: height,
        process: (sample) => {
          compositor.render(ctx, (c, x, y, w, h) => sample.draw(c, x, y, w, h), width, height, settings);
          return new VideoSample(canvas, { timestamp: sample.timestamp, duration: sample.duration });
        },
      },
      audio: { codec: 'opus' },
    });
    const video = conversion.discardedTracks.find((d) => d.track.isVideoTrack());
    if (video) throw new MediaError(video.reason === 'no_encodable_target_codec' ? 'unsupported-codec' : 'unsupported-input', "This browser can't make a transparent WebM from this video.");
    const notes = conversion.discardedTracks.some((d) => d.track.isAudioTrack() && d.reason !== 'discarded_by_user') ? ["This browser couldn't encode the sound as Opus, so the WebM is silent."] : [];
    conversion.onProgress = (p) => ctl.onProgress?.(p);
    if (ctl.signal?.aborted) throw new MediaError('aborted', 'Cancelled.');
    await conversion.execute();
    return {
      blob: new Blob([target.buffer!], { type: 'video/webm' }),
      container: 'webm',
      mimeWithCodecs: await output.getMimeType(),
      width,
      height,
      durationSec: await input.computeDuration(),
      notes,
      via: 'mediabunny',
    };
  } catch (e) {
    throw ctl.signal?.aborted ? new MediaError('aborted', 'Cancelled.') : toMediaError(e);
  } finally {
    ctl.signal?.removeEventListener('abort', cancel);
    input.dispose();
  }
}

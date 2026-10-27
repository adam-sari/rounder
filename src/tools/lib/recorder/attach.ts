import type { Attachment } from 'svelte/attachments';

/** plays a live stream in a <video> (srcObject can't be set from markup) */
export const liveStream =
  (stream: MediaStream | null): Attachment<HTMLVideoElement> =>
  (video) => {
    video.srcObject = stream;
    return () => {
      video.srcObject = null;
    };
  };

/** places an element created in code (e.g. the compositing canvas) inside this one */
export const holding =
  (child: Element): Attachment<HTMLElement> =>
  (host) => {
    host.append(child);
    return () => child.remove();
  };

import { renderBlocks } from './render';

// Parsing a 50k-line document can take a few hundred ms, so it happens here, off the page
self.onmessage = (e: MessageEvent<{ id: number; src: string }>) => {
  const { id, src } = e.data;
  self.postMessage({ id, src, ...renderBlocks(src) });
};

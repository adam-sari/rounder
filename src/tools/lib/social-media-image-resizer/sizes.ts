import type { Rect } from '@/engines/image/types';

export type Platform = 'instagram' | 'facebook' | 'x' | 'linkedin' | 'youtube' | 'pinterest' | 'tiktok' | 'threads';

export const platforms: Record<Platform, { name: string; color: string }> = {
  instagram: { name: 'Instagram', color: '#ff8fb8' },
  facebook: { name: 'Facebook', color: '#7cc4ff' },
  x: { name: 'X', color: '#f2ede4' },
  linkedin: { name: 'LinkedIn', color: '#5fe0d0' },
  youtube: { name: 'YouTube', color: '#ff6b4a' },
  pinterest: { name: 'Pinterest', color: '#ff7a6b' },
  tiktok: { name: 'TikTok', color: '#c8a6ff' },
  threads: { name: 'Threads', color: '#c9c2b6' },
};

export interface SocialSize {
  id: string;
  platform: Platform;
  label: string;
  width: number;
  height: number;
  /** what gets covered or cropped once posted */
  note?: string;
  /** centered area that every device shows, drawn on the preview only */
  safe?: { width: number; height: number };
}

export const sizes: SocialSize[] = [
  { id: 'ig-post', platform: 'instagram', label: 'Square post', width: 1080, height: 1080 },
  { id: 'ig-portrait', platform: 'instagram', label: 'Portrait post', width: 1080, height: 1350 },
  { id: 'ig-story', platform: 'instagram', label: 'Story & Reel', width: 1080, height: 1920, note: 'app buttons cover the top and bottom edges' },
  { id: 'fb-post', platform: 'facebook', label: 'Post & link image', width: 1200, height: 630 },
  { id: 'fb-cover', platform: 'facebook', label: 'Page cover', width: 1640, height: 624, note: 'phones show a narrower slice, so keep the subject centered' },
  { id: 'x-post', platform: 'x', label: 'Post image', width: 1600, height: 900 },
  { id: 'x-header', platform: 'x', label: 'Header', width: 1500, height: 500, note: 'your profile photo overlaps the lower left' },
  { id: 'li-post', platform: 'linkedin', label: 'Post image', width: 1200, height: 627 },
  { id: 'li-banner', platform: 'linkedin', label: 'Profile banner', width: 1584, height: 396, note: 'your profile photo overlaps the left side' },
  { id: 'yt-thumb', platform: 'youtube', label: 'Thumbnail', width: 1280, height: 720, note: 'the video length covers the bottom-right corner' },
  { id: 'yt-banner', platform: 'youtube', label: 'Channel banner', width: 2560, height: 1440, note: 'only the middle 1546 × 423 shows on every device', safe: { width: 1546, height: 423 } },
  { id: 'pin', platform: 'pinterest', label: 'Pin', width: 1000, height: 1500 },
  { id: 'tiktok', platform: 'tiktok', label: 'Video cover', width: 1080, height: 1920, note: 'captions and buttons cover the bottom and right' },
  { id: 'threads', platform: 'threads', label: 'Post image', width: 1080, height: 1350 },
];

export const defaultSelection = ['ig-post', 'ig-portrait', 'ig-story', 'fb-post', 'x-post', 'li-post'];

/** crop: fill the frame and cut off the overflow; blur / solid: show the whole image on a background */
export type Fit = 'crop' | 'blur' | 'solid';

/** a point in the image, as fractions of its width and height, kept as close to the center as the crop allows */
export interface Focus {
  x: number;
  y: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The part of a w × h image that fills a W × H frame, centered on focus as far as the edges allow */
export function focalCrop(w: number, h: number, W: number, H: number, focus: Focus, zoom = 1): Rect {
  const s = Math.max(W / w, H / h) * Math.max(1, zoom);
  const width = Math.min(w, W / s);
  const height = Math.min(h, H / s);
  return {
    x: clamp(focus.x * w - width / 2, 0, w - width),
    y: clamp(focus.y * h - height / 2, 0, h - height),
    width,
    height,
  };
}

/** Moves the focus as if the image were dragged by (dx, dy) output pixels, and keeps it where the crop can follow */
export function panFocus(w: number, h: number, W: number, H: number, focus: Focus, dx: number, dy: number, zoom = 1): Focus {
  const crop = focalCrop(w, h, W, H, focus, zoom);
  const s = W / crop.width;
  const moved = focalCrop(w, h, W, H, { x: focus.x - dx / s / w, y: focus.y - dy / s / h }, zoom);
  return { x: (moved.x + moved.width / 2) / w, y: (moved.y + moved.height / 2) / h };
}

/** Where a w × h image sits when fitted whole inside a W × H frame */
export function containRect(w: number, h: number, W: number, H: number): Rect {
  const s = Math.min(W / w, H / h);
  const width = Math.round(w * s);
  const height = Math.round(h * s);
  return { x: Math.round((W - width) / 2), y: Math.round((H - height) / 2), width, height };
}

/** Rounds a crop to whole source pixels without spilling past the image */
export function pixelCrop(r: Rect, w: number, h: number): Rect {
  const x = clamp(Math.round(r.x), 0, w - 1);
  const y = clamp(Math.round(r.y), 0, h - 1);
  return { x, y, width: clamp(Math.round(r.width), 1, w - x), height: clamp(Math.round(r.height), 1, h - y) };
}

/** "beach.jpg" + Instagram story → "beach-instagram-story-reel-1080x1920.jpg" */
export function outputName(source: string, size: SocialSize, ext: string) {
  const base = source.replace(/\.[^.]+$/, '') || 'image';
  const slug = `${platforms[size.platform].name} ${size.label}`.toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base}-${slug}-${size.width}x${size.height}.${ext}`;
}

/** true when output pixels would have to be invented to fill the size */
export function upscaled(w: number, h: number, size: SocialSize, fit: Fit) {
  const s = fit === 'crop' ? Math.max(size.width / w, size.height / h) : Math.min(size.width / w, size.height / h);
  return s > 1.05;
}

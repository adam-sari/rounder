import type { Tool } from './editor.svelte';

/** 24×24 stroke icons (inner SVG markup, drawn with currentColor) */
export const toolIcons: Record<Tool, string> = {
  select: '<path d="M6 3.5l12 8.2-5.3 1.1 3 5.6-2.4 1.3-3-5.6L6 18z"/>',
  text: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
  name: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1-3.6 3.8-5.5 7-5.5s6 1.9 7 5.5"/>',
  date: '<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  check: '<path d="M4.5 12.5l4.8 4.8L19.5 7"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  signature: '<path d="M3 17c2.5-.2 4-6 5.5-10.5C9.6 3.4 11 4 10.5 8c-.6 5-2.5 9-1 9 1.6 0 2.3-4 3.8-4 1.2 0 .7 3 2 3 1 0 1.6-1.4 2.7-1.4"/><path d="M3 20.5h18"/>',
  initials: '<path d="M5 17V7h3M5 12h2.5M11 7h3.5a2.5 2.5 0 0 1 0 5H11zm0 5v5"/><path d="M3 20.5h18"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 2.5-2 4.5 4"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  whiteout: '<rect x="3.5" y="7" width="17" height="10" rx="1.5" fill="currentColor" fill-opacity=".22"/><path d="M7 12h10" stroke-dasharray="2 2.5"/>',
  highlight: '<path d="M14.5 4.5l5 5-7.5 7.5H7v-5z"/><path d="M4 20.5h16" stroke-width="3" stroke-opacity=".55"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L18 6M10 5.5h8.5V14"/>',
  ink: '<path d="M3.5 16c2.5-5 4.5-7 6-7 2.5 0 .5 6 3 6 2 0 3-5 5-5 1.2 0 1.8 1 2.5 2"/>',
};

export const toolLabels: Record<Tool, string> = {
  select: 'Select',
  text: 'Text',
  name: 'Name',
  date: 'Date',
  check: 'Check',
  cross: 'Cross',
  signature: 'Signature',
  initials: 'Initials',
  image: 'Image',
  rect: 'Box',
  ellipse: 'Circle',
  whiteout: 'Whiteout',
  highlight: 'Highlight',
  line: 'Line',
  arrow: 'Arrow',
  ink: 'Draw',
};

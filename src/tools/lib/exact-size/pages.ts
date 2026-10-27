import { toolSource, tools, type Tool } from '@/tools/registry';

/** the hub that lists every exact-size preset page */
export const HUB = '/compress-to-exact-size';

/** exact-size and India form presets live in src/tools/defs/exact-*.ts and india-*.ts */
export const isSizePreset = (t: Tool) => /\/defs\/(exact|india)-[\w-]+\.ts$/.test(toolSource[t.slug] ?? '');

export const sizePresets = () => tools.filter(isSizePreset);

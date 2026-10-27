import { vitePreprocess } from '@astrojs/svelte';

export default {
  preprocess: vitePreprocess(),
  vitePlugin: {
    // Tool islands load lazily through ToolHost's glob import, which would otherwise hoist the CSS of
    // every tool into every page (~250 KB). Their styles ship inside their own JS chunks instead.
    dynamicCompileOptions({ filename }) {
      if (/[\\/]src[\\/](tools|engines)[\\/]/.test(filename)) return { css: 'injected' };
    },
  },
};

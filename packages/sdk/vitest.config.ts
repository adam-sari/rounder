import { defineConfig } from 'vitest/config';

// the tests run against the built package (dist/), the way users get it: build first with `npm run build`
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false } });

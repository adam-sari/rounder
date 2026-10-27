import { defineConfig, devices } from '@playwright/test';

// a production build outside the repo, so it never clobbers dist/ or the dev server on :4321
export const DIST = process.env.E2E_DIST ?? 'D:/work/personal/.rounder-e2edist';
const PORT = 4600;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  // Playwright's Firefox now and then fails to close a context after an image download (an error inside
  // Firefox's session store, not the page); retries absorb that and the report lists those tests as flaky
  retries: 2,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: `http://localhost:${PORT}`, acceptDownloads: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // phones with touch: the closest stand-ins for iOS Safari and Android Chrome. Media and network flows stay
    // on desktop (the same engines run them), the page and file tools run here too
    { name: 'iphone', use: { ...devices['iPhone 15'] }, grepInvert: /(media|everyday|offline) flows/ },
    { name: 'android', use: { ...devices['Pixel 7'] }, grepInvert: /(media|everyday|offline) flows/ },
  ],
  webServer: {
    // E2E_SKIP_BUILD=1 reuses the last build when only the tests changed
    command: `${process.env.E2E_SKIP_BUILD ? '' : `npm run build -- --outDir "${DIST}" && `}node scripts/serve-dist.mjs "${DIST}" . ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
  },
});

import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://patelrep-production-0ad1.up.railway.app'

// `reducedMotion` is a genuine Playwright BrowserContext option but isn't
// declared on the pinned @playwright/test version's `use` config type here —
// build the object as a non-literal `const` first so TS's excess-property
// check (which only fires on fresh object literals) doesn't reject it.
const use = {
  ...devices['Desktop Chrome'],
  baseURL,
  headless: true,
  reducedMotion: 'reduce' as const,
  viewport: { width: 1440, height: 900 },
}

// FOUND-03 regression harness: authenticated, deterministic pixel-diff of
// the 3 excluded Room Board surfaces against the never-operated, cron-inert
// regression fixture tenant (see e2e/fixtures/seed-regression-tenant.mjs).
// maxDiffPixelRatio: 0 — an unchanged tree must render byte-identically.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'room-board-baseline.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  timeout: 45000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0,
      animations: 'disabled',
    },
  },
  use,
})

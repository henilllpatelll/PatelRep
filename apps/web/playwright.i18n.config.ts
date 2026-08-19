import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

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

// 37-01 (bug-965 fix regression gate): forces an async-mounted StateBlock
// error and toggles to Spanish, asserting the exact es.ts string renders
// with zero EN/ES glossary-hybrid mangling. Tests text content, not pixels,
// so it defaults to the local dev server (dev:web) rather than the dead
// hardcoded production URL playwright.regression.config.ts uses — no
// standalone-build workaround needed for this spec.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'i18n-dom-translator.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60000,
  use,
})

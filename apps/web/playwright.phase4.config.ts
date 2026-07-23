import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://patelrep-production-0ad1.up.railway.app'

// Phase 4 / 04-08 (Slice 4C -- bilingual floor contract). Mirrors
// playwright.phase1.config.ts, but every project renders at a 390px-wide
// phone viewport so the EN/ES critical-floor-workflow coverage is verified
// at the width real housekeepers/engineers actually use on the floor.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'phase4-*.spec.ts',
  timeout: 30000,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: 'phone-390px',
      // Chromium (not a WebKit device profile like 'iPhone 12') so this
      // matches the chromium/firefox browsers already installed for the
      // rest of this project's Playwright suites, while still rendering at
      // real phone width via viewport override.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
})

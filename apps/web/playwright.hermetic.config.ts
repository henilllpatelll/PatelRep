import { defineConfig, devices } from '@playwright/test'

// Credential-free Room-Board visual gate. Runs the SAME three-surface spec as the live regression harness
// (room-board-baseline.spec.ts, maxDiffPixelRatio 0) against the candidate's own production build, with a
// local mock backend standing in for Supabase auth and the API. No repository secret is read or needed, so
// Dependabot PRs can run it and untrusted dependency code never sees a credential.
// Must equal HERMETIC_PASSWORD in e2e/hermetic/mock-backend.mjs (asserted by mock-backend.test.mjs). This file is
// loaded as CommonJS by Playwright, so it cannot import that ES module.
const HERMETIC_PASSWORD = 'hermetic-fixture-not-a-secret'
const WEB_PORT = Number(process.env.HERMETIC_WEB_PORT ?? 3101)
const MOCK_PORT = Number(process.env.HERMETIC_MOCK_PORT ?? 4010)
const baseURL = `http://127.0.0.1:${WEB_PORT}`

// The shared globalSetup reads fixture credentials from these variables. Synthetic, non-secret constants.
process.env.REGRESSION_GM_EMAIL = 'gm@hermetic.invalid'
process.env.REGRESSION_GM_PASSWORD = HERMETIC_PASSWORD
process.env.REGRESSION_SUP_EMAIL = 'supervisor@hermetic.invalid'
process.env.REGRESSION_SUP_PASSWORD = HERMETIC_PASSWORD
process.env.PLAYWRIGHT_BASE_URL = baseURL

const use = {
  ...devices['Desktop Chrome'],
  baseURL,
  headless: true,
  reducedMotion: 'reduce' as const,
  // Pinned so rendered times and number formats never depend on the runner's locale or timezone.
  locale: 'en-US',
  timezoneId: 'America/Chicago',
  viewport: { width: 1440, height: 900 },
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'room-board-baseline.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  // Separate baseline directory: the hermetic fixture data differs from the live tenant, the comparison does not.
  snapshotPathTemplate: '{testDir}/room-board-hermetic-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}',
  timeout: 45000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0, animations: 'disabled' } },
  use,
  webServer: [
    {
      command: 'node e2e/hermetic/mock-backend.mjs',
      url: `http://127.0.0.1:${MOCK_PORT}/v1/health`,
      env: { HERMETIC_MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'node .next/standalone/server.js',
      url: `${baseURL}/login`,
      env: { PORT: String(WEB_PORT), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
})

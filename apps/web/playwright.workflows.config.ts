import { defineConfig, devices } from '@playwright/test'

// Credential-free browser workflow checks (Phase 12). Same hermetic mock backend and production build as the Room-Board
// gate, but a separate config so it never changes that gate's job or its pixel baselines. Every write the specs make is
// intercepted in the page (page.route) and answered with a realistic success, validation error or failure; the mock
// backend only serves reads. Nothing here can reach production or shared staging.
//   Build first (V2 flag + mock origin, see e2e/hermetic/run.mjs), then:  npm run test:e2e:workflows
const HERMETIC_PASSWORD = 'hermetic-fixture-not-a-secret'
const WEB_PORT = Number(process.env.HERMETIC_WEB_PORT ?? 3101)
const MOCK_PORT = Number(process.env.HERMETIC_MOCK_PORT ?? 4010)
const baseURL = `http://127.0.0.1:${WEB_PORT}`

process.env.REGRESSION_GM_EMAIL = 'gm@hermetic.invalid'
process.env.REGRESSION_GM_PASSWORD = HERMETIC_PASSWORD
process.env.REGRESSION_SUP_EMAIL = 'supervisor@hermetic.invalid'
process.env.REGRESSION_SUP_PASSWORD = HERMETIC_PASSWORD
process.env.PLAYWRIGHT_BASE_URL = baseURL

export default defineConfig({
  testDir: './e2e',
  testMatch: 'workflows-hermetic.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60000,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    headless: true,
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: 'node e2e/hermetic/mock-backend.mjs',
      url: `http://127.0.0.1:${MOCK_PORT}/v1/health`,
      // Production tenants have every redesigned section on (migration 098); mirror that and the data-rich fixtures.
      env: { HERMETIC_MOCK_PORT: String(MOCK_PORT), HERMETIC_REDESIGN_SECTIONS: 'all', HERMETIC_RICH_DATA: '1' },
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

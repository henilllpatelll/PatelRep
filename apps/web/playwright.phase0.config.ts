import { defineConfig, devices } from '@playwright/test'

const webPort = 3000
const baseURL = `http://localhost:${webPort}`

export default defineConfig({
  testDir: './e2e',
  testMatch: 'phase0-public-smoke.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-phase0' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --hostname localhost --port ${webPort}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
      NEXT_PUBLIC_API_URL: 'http://localhost:8000/v1',
    },
  },
})

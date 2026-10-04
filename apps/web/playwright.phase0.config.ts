import { defineConfig, devices } from '@playwright/test'

const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3000)
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
    // Webpack dev: Turbopack dev (16.3.0-preview) fails to resolve next/font/google
    // ("@vercel/turbopack-next/internal/font/google/font"), so /login never serves.
    command: `npm run dev -- --webpack --hostname localhost --port ${webPort}`,
    url: `${baseURL}/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      NEXT_DIST_DIR: '.next-phase0',
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
      NEXT_PUBLIC_API_URL: 'http://localhost:8000/v1',
    },
  },
})

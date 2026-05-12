import { defineConfig } from '@playwright/test'

const BASE_URL = 'https://patelrepweb-production.up.railway.app'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/mobile-usability.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'mobile-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'on',
    actionTimeout: 20_000,
    navigationTimeout: 40_000,
    // Mobile user agent for CSS media queries
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {},
    },
  ],
})

import { defineConfig } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://patelrep-production-0ad1.up.railway.app'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'phase1-*.spec.ts',
  timeout: 30000,
  use: {
    baseURL,
    headless: true,
  },
})

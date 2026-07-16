import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'phase1-*.spec.ts',
  timeout: 30000,
  use: {
    baseURL: 'https://patelrep-production-0ad1.up.railway.app',
    headless: true,
  },
})

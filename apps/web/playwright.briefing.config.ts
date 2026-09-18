import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'

if (existsSync('.env.regression')) loadEnvFile('.env.regression')

export default defineConfig({
  testDir: './e2e',
  testMatch: 'dashboard-briefing.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: !!process.env.CI,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'reduced-motion', use: { ...devices['Desktop Chrome'] } },
  ],
})

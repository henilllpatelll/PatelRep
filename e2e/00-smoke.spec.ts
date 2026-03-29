/**
 * Smoke tests — every authenticated route loads without a crash.
 * Fast signal: if any route is completely broken this will catch it.
 */
import { test, expect } from '@playwright/test'

const ROUTES = [
  '/dashboard',
  '/housekeeping',
  '/housekeeping/assignments',
  '/housekeeping/inspections',
  '/housekeeping/rooms',
  '/engineering',
  '/engineering/assets',
  '/engineering/pm-schedules',
  '/engineering/predictions',
  '/staff',
  '/logbook',
  '/tasks',
  '/scheduling',
  '/sop',
  '/guest-requests',
  '/lost-found',
  '/reports',
  '/ai',
  '/billing',
  '/settings',
]

for (const route of ROUTES) {
  test(`${route} — loads without crash`, async ({ page }) => {
    await page.goto(route)
    await page.waitForLoadState('networkidle')

    // Must not redirect to login (session should be valid)
    await expect(page).not.toHaveURL(/\/login/)

    // Must not show Next.js/React error overlay
    await expect(page.locator('text=Application error')).not.toBeVisible()
    await expect(page.locator('text=Unhandled Runtime Error')).not.toBeVisible()

    // Must not be a 404
    await expect(page.locator('text=404')).not.toBeVisible()
  })
}

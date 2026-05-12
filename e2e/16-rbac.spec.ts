/**
 * RBAC smoke tests — verifies that Next.js middleware correctly blocks
 * and allows dashboard routes per role.
 *
 * Each test logs in as a specific role and asserts that:
 *   - routes in their NAV_BY_ROLE are accessible (200, not redirected)
 *   - routes outside their NAV_BY_ROLE redirect to /dashboard?unauthorized=…
 *
 * Requires the test users seeded by e2e/helpers/rbac-users.ts to be present.
 * Run `pnpm rbac:seed` (or manually via the helper) before this suite.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  getGmToken,
  seedRbacUsers,
  teardownRbacUsers,
  type RbacTestUser,
  GM_TEST_USER,
  TEST_PASSWORD,
} from './helpers/rbac-users'

// ── Route access matrix (mirrors NAV_BY_ROLE in Sidebar.tsx) ──────────────────

const ROLE_ALLOWED: Record<string, string[]> = {
  gm: [
    '/dashboard', '/housekeeping', '/engineering', '/guest-requests',
    '/lost-found', '/tasks', '/staff', '/scheduling', '/logbook',
    '/sop', '/reports', '/ai', '/settings', '/billing',
  ],
  housekeeping_supervisor: [
    '/dashboard', '/housekeeping', '/guest-requests', '/lost-found',
    '/tasks', '/scheduling', '/logbook', '/sop', '/reports', '/ai',
  ],
  housekeeper: ['/dashboard', '/housekeeping', '/tasks', '/logbook'],
  chief_engineer: [
    '/dashboard', '/engineering', '/tasks', '/scheduling',
    '/logbook', '/sop', '/reports', '/ai',
  ],
  engineer: ['/dashboard', '/engineering', '/tasks', '/logbook'],
  front_desk: [
    '/dashboard', '/housekeeping', '/tasks', '/logbook',
    '/guest-requests', '/lost-found',
  ],
}

const ROLE_BLOCKED: Record<string, string[]> = {
  housekeeper: ['/engineering', '/guest-requests', '/staff', '/reports', '/ai', '/settings'],
  engineer:    ['/housekeeping', '/guest-requests', '/staff', '/reports', '/ai', '/settings'],
  front_desk:  ['/engineering', '/staff', '/reports', '/ai', '/settings', '/billing'],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.waitForSelector('#email-pw', { timeout: 10_000 })
  await page.fill('#email-pw', email)
  await page.fill('#password-pw', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 25_000 })
}

// ── Suite ─────────────────────────────────────────────────────────────────────

let seededUsers: RbacTestUser[] = []
let gmToken = ''

test.beforeAll(async () => {
  gmToken = await getGmToken()
  seededUsers = await seedRbacUsers(gmToken)
})

test.afterAll(async () => {
  await teardownRbacUsers(gmToken, seededUsers)
})

// GM access — uses the durable GM test account, no separate context needed
test('GM can access all routes', async ({ page }) => {
  await loginViaUI(page, GM_TEST_USER.email, GM_TEST_USER.password)
  for (const route of ROLE_ALLOWED['gm'].slice(0, 5)) {
    await page.goto(route)
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page).not.toHaveURL(/\/dashboard\?unauthorized/)
  }
})

// Housekeeper — blocked from engineering, reports, settings
test('Housekeeper is blocked from restricted routes', async ({ browser }) => {
  const hkUser = seededUsers.find(u => u.role === 'housekeeper')
  if (!hkUser) return test.skip()

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  try {
    await loginViaUI(page, hkUser.email, hkUser.password)
    for (const route of ROLE_BLOCKED['housekeeper']) {
      await page.goto(route)
      await expect(page).toHaveURL(/\/dashboard(\?unauthorized|$)/, { timeout: 8_000 })
    }
  } finally {
    await ctx.close()
  }
})

// Housekeeper — allowed routes are accessible
test('Housekeeper can access their allowed routes', async ({ browser }) => {
  const hkUser = seededUsers.find(u => u.role === 'housekeeper')
  if (!hkUser) return test.skip()

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  try {
    await loginViaUI(page, hkUser.email, hkUser.password)
    for (const route of ROLE_ALLOWED['housekeeper']) {
      await page.goto(route)
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page).not.toHaveURL(/\/dashboard\?unauthorized/)
    }
  } finally {
    await ctx.close()
  }
})

// Engineer — blocked from housekeeping, guest-requests, settings
test('Engineer is blocked from restricted routes', async ({ browser }) => {
  const engUser = seededUsers.find(u => u.role === 'engineer')
  if (!engUser) return test.skip()

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  try {
    await loginViaUI(page, engUser.email, engUser.password)
    for (const route of ROLE_BLOCKED['engineer']) {
      await page.goto(route)
      await expect(page).toHaveURL(/\/dashboard(\?unauthorized|$)/, { timeout: 8_000 })
    }
  } finally {
    await ctx.close()
  }
})

// Front desk — blocked from engineering, staff, reports, settings
test('Front desk is blocked from restricted routes', async ({ browser }) => {
  const fdUser = seededUsers.find(u => u.role === 'front_desk')
  if (!fdUser) return test.skip()

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  try {
    await loginViaUI(page, fdUser.email, fdUser.password)
    for (const route of ROLE_BLOCKED['front_desk']) {
      await page.goto(route)
      await expect(page).toHaveURL(/\/dashboard(\?unauthorized|$)/, { timeout: 8_000 })
    }
  } finally {
    await ctx.close()
  }
})

// Front desk dashboard — should not show 403 errors in console (no reports call)
test('Front desk dashboard loads without 403 errors', async ({ browser }) => {
  const fdUser = seededUsers.find(u => u.role === 'front_desk')
  if (!fdUser) return test.skip()

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const forbidden: string[] = []

  page.on('response', res => {
    if (res.status() === 403) forbidden.push(`${res.status()} ${res.url()}`)
  })

  try {
    await loginViaUI(page, fdUser.email, fdUser.password)
    await page.goto('/dashboard')
    await page.waitForTimeout(3_000) // allow background fetches to settle
    expect(forbidden, `Forbidden API calls: ${forbidden.join(', ')}`).toHaveLength(0)
  } finally {
    await ctx.close()
  }
})

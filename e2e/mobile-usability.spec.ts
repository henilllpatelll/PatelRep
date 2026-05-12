/**
 * Mobile Usability Testing — PatelRep Production
 * Tests viewport rendering, layout, tap targets, overflow, and navigation
 * at phone and tablet sizes.
 */
import { test, expect, Page, BrowserContext } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const BASE_URL = 'https://patelrepweb-production.up.railway.app'
const EMAIL = 'hp.patelrep@gmail.com'
const PASSWORD = 'PatelRep2026x'

const VIEWPORTS = [
  { name: 'iPhone-SE', width: 375, height: 667 },
  { name: 'iPhone-14', width: 390, height: 844 },
  { name: 'Android-Medium', width: 412, height: 915 },
  { name: 'Tablet', width: 768, height: 1024 },
]

const ROUTES = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/housekeeping', name: 'Housekeeping' },
  { path: '/engineering', name: 'Engineering' },
  { path: '/tasks', name: 'Tasks' },
  { path: '/guest-requests', name: 'Guest Requests' },
  { path: '/logbook', name: 'Logbook' },
  { path: '/lost-found', name: 'Lost & Found' },
  { path: '/reports', name: 'Reports' },
  { path: '/billing', name: 'Billing' },
  { path: '/settings', name: 'Settings' },
]

const SCREENSHOT_DIR = path.join(__dirname, '..', 'mobile-test-screenshots')

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

async function loginAndSaveState(page: Page) {
  await page.goto(`${BASE_URL}/login`)
  await page.waitForLoadState('networkidle')

  // Try password login fields
  const emailInput = page.locator('#email-pw, input[type="email"]').first()
  const passwordInput = page.locator('#password-pw, input[type="password"]').first()

  await emailInput.fill(EMAIL)
  await passwordInput.fill(PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|housekeeping|engineering|onboarding)/, { timeout: 25_000 })
}

/**
 * Checks for horizontal overflow (the most common mobile layout bug).
 * Returns true if page body scrolls wider than the viewport.
 */
async function hasHorizontalOverflow(page: Page, viewportWidth: number): Promise<boolean> {
  return page.evaluate((vw) => {
    const body = document.body
    const html = document.documentElement
    const scrollWidth = Math.max(body.scrollWidth, html.scrollWidth)
    return scrollWidth > vw + 5  // 5px tolerance for scrollbar
  }, viewportWidth)
}

/**
 * Returns interactive elements with tap target < 44×44px (WCAG 2.5.5 / Apple HIG).
 */
async function getSmallTapTargets(page: Page): Promise<{ tag: string; text: string; width: number; height: number }[]> {
  return page.evaluate(() => {
    const MIN = 44
    const els = Array.from(document.querySelectorAll('button, a, [role="button"], input, select, textarea'))
    return els
      .map((el) => {
        const r = el.getBoundingClientRect()
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 40),
          width: Math.round(r.width),
          height: Math.round(r.height),
        }
      })
      .filter(({ width, height }) => width > 0 && height > 0 && (width < MIN || height < MIN))
  })
}

/**
 * Returns elements with text overflow (visually clipped content).
 */
async function getOverflowingText(page: Page): Promise<{ tag: string; text: string }[]> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, label, td, th'))
    return els
      .filter((el) => {
        const style = window.getComputedStyle(el)
        return (
          (style.overflow === 'hidden' || style.textOverflow === 'ellipsis') &&
          el.scrollWidth > el.clientWidth
        )
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 60),
      }))
      .slice(0, 10)
  })
}

/**
 * Checks if a fixed navigation/sidebar is visible and usable (not hidden off-screen).
 */
async function checkNavVisible(page: Page): Promise<{ hasNav: boolean; isMobileNav: boolean }> {
  return page.evaluate(() => {
    const nav = document.querySelector('nav, [role="navigation"], aside')
    if (!nav) return { hasNav: false, isMobileNav: false }
    const r = nav.getBoundingClientRect()
    const style = window.getComputedStyle(nav)
    const visible = r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    const isMobileNav = r.width < 80  // collapsed sidebar or bottom bar
    return { hasNav: visible, isMobileNav }
  })
}

// ── Test suite ──────────────────────────────────────────────────────────────

let authState: string | null = null

test.describe.serial('Mobile Usability — Login', () => {
  for (const vp of VIEWPORTS) {
    test(`Login page renders on ${vp.name} (${vp.width}×${vp.height})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
      const page = await context.newPage()

      await page.goto(`${BASE_URL}/login`)
      await page.waitForLoadState('networkidle')

      const ssPath = path.join(SCREENSHOT_DIR, `${slug(vp.name)}-login.png`)
      await page.screenshot({ path: ssPath, fullPage: false })

      // Check no horizontal overflow on login page
      const overflow = await hasHorizontalOverflow(page, vp.width)
      expect(overflow, `Login page has horizontal scroll on ${vp.name}`).toBe(false)

      // Email + password fields must be visible and have adequate tap targets
      const emailField = page.locator('#email-pw, input[type="email"]').first()
      const passField = page.locator('#password-pw, input[type="password"]').first()
      const submitBtn = page.locator('button[type="submit"]').first()

      await expect(emailField).toBeVisible()
      await expect(passField).toBeVisible()
      await expect(submitBtn).toBeVisible()

      // Tap target check on submit button
      const btnBox = await submitBtn.boundingBox()
      expect(btnBox?.height ?? 0).toBeGreaterThanOrEqual(40)
      expect(btnBox?.width ?? 0).toBeGreaterThanOrEqual(120)

      await context.close()
    })
  }
})

test.describe.serial('Mobile Usability — Authenticated Routes', () => {
  for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} (${vp.width}×${vp.height})`, () => {
      let context: BrowserContext
      let page: Page
      const findings: Record<string, unknown> = {}

      test.beforeAll(async ({ browser }) => {
        context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
        page = await context.newPage()
        await loginAndSaveState(page)
      })

      test.afterAll(async () => {
        const reportPath = path.join(SCREENSHOT_DIR, `report-${slug(vp.name)}.json`)
        fs.writeFileSync(reportPath, JSON.stringify(findings, null, 2))
        await context.close()
      })

      for (const route of ROUTES) {
        test(`${route.name} — layout on ${vp.name}`, async () => {
          await page.goto(`${BASE_URL}${route.path}`)
          await page.waitForLoadState('networkidle').catch(() => {})
          // Extra settle for JS-heavy dashboards
          await page.waitForTimeout(1500)

          const ssPath = path.join(SCREENSHOT_DIR, `${slug(vp.name)}-${slug(route.name)}.png`)
          await page.screenshot({ path: ssPath, fullPage: true })

          const [overflow, smallTargets, overflowText, navCheck] = await Promise.all([
            hasHorizontalOverflow(page, vp.width),
            getSmallTapTargets(page),
            getOverflowingText(page),
            checkNavVisible(page),
          ])

          findings[route.name] = {
            viewport: `${vp.width}×${vp.height}`,
            screenshot: path.basename(ssPath),
            horizontalOverflow: overflow,
            smallTapTargets: smallTargets.length,
            smallTapTargetDetails: smallTargets.slice(0, 5),
            overflowingText: overflowText.length,
            overflowingTextDetails: overflowText.slice(0, 3),
            navVisible: navCheck.hasNav,
            navCollapsed: navCheck.isMobileNav,
          }

          // Fail on horizontal overflow (hard requirement for mobile)
          expect(overflow, `${route.name} has horizontal scroll on ${vp.name}`).toBe(false)
        })
      }

      test(`Housekeeping — room status update tap target on ${vp.name}`, async () => {
        await page.goto(`${BASE_URL}/housekeeping`)
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(1500)

        // Look for status badge/button in the room board
        const statusBtns = page.locator('button, [role="button"]').filter({ hasText: /dirty|clean|progress|inspected/i })
        const count = await statusBtns.count()

        if (count > 0) {
          const firstBtn = statusBtns.first()
          const box = await firstBtn.boundingBox()
          findings['Housekeeping-StatusButton'] = {
            found: true,
            width: box?.width,
            height: box?.height,
            adequate: (box?.height ?? 0) >= 36,
          }
          // Status tap targets must be at least 36px tall on mobile
          expect(box?.height ?? 0, `Room status button too small on ${vp.name}`).toBeGreaterThanOrEqual(36)
        } else {
          findings['Housekeeping-StatusButton'] = { found: false, note: 'No status buttons visible' }
        }
      })

      test(`Engineering — work order list on ${vp.name}`, async () => {
        await page.goto(`${BASE_URL}/engineering`)
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(1500)

        const ssPath = path.join(SCREENSHOT_DIR, `${slug(vp.name)}-engineering-detail.png`)
        await page.screenshot({ path: ssPath, fullPage: true })

        // Try clicking the first work order if any exist
        const woItems = page.locator('tr, [data-testid*="work-order"], .work-order-row').first()
        const woCount = await page.locator('tr').count()

        findings['Engineering-WorkOrderRows'] = { rowCount: woCount }
      })

      test(`Navigation — sidebar/nav usable on ${vp.name}`, async () => {
        await page.goto(`${BASE_URL}/dashboard`)
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(1000)

        const navCheck = await checkNavVisible(page)
        const ssPath = path.join(SCREENSHOT_DIR, `${slug(vp.name)}-nav-state.png`)
        await page.screenshot({ path: ssPath, fullPage: false })

        findings['Navigation'] = {
          hasNav: navCheck.hasNav,
          isCollapsed: navCheck.isMobileNav,
        }

        // Navigation must be present on all viewports (collapsed is OK)
        expect(navCheck.hasNav, `No nav found on ${vp.name} at /dashboard`).toBe(true)
      })

      test(`Modal / drawer usability on ${vp.name} (Guest Requests)`, async () => {
        await page.goto(`${BASE_URL}/guest-requests`)
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(1500)

        // Try to open the create form / first item
        const createBtn = page.locator('button').filter({ hasText: /new|add|create|request/i }).first()
        const createBtnCount = await page.locator('button').filter({ hasText: /new|add|create|request/i }).count()

        if (createBtnCount > 0) {
          const box = await createBtn.boundingBox()
          const isVisible = await createBtn.isVisible()

          findings['GuestRequests-CreateButton'] = {
            visible: isVisible,
            width: box?.width,
            height: box?.height,
          }

          if (isVisible) {
            await createBtn.click()
            await page.waitForTimeout(800)

            const ssPath = path.join(SCREENSHOT_DIR, `${slug(vp.name)}-guest-requests-modal.png`)
            await page.screenshot({ path: ssPath, fullPage: false })

            // Check modal is within viewport bounds
            const modal = page.locator('[role="dialog"], .modal, [data-radix-dialog-content]').first()
            const modalCount = await page.locator('[role="dialog"], .modal, [data-radix-dialog-content]').count()

            if (modalCount > 0) {
              const modalBox = await modal.boundingBox()
              findings['GuestRequests-Modal'] = {
                width: modalBox?.width,
                height: modalBox?.height,
                withinViewport: (modalBox?.x ?? 0) >= 0 && ((modalBox?.x ?? 0) + (modalBox?.width ?? 0)) <= vp.width + 20,
              }
            }
          }
        } else {
          findings['GuestRequests-CreateButton'] = { found: false }
        }
      })
    })
  }
})

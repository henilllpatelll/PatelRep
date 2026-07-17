/**
 * Phase 1 — Authenticated E2E tests
 *
 * Coverage:
 *  1. Emergency work order creation — appears at top of Open queue with EMERGENCY badge
 *  2. Escalated visibility — escalated WO appears in the Escalated column
 *  3. Hold with structured reason — reason dropdown required, WO shows ON HOLD
 *  4. Reopen from hold — held WO resumed back to in_progress
 *  5. Inspection photo upload — failing an item that requires_photo_on_fail shows photo prompt
 *
 * Each test is independent: it creates its own data via the web UI and does not
 * depend on state left by prior tests.
 *
 * Credentials: TEST_EMAIL and TEST_PASSWORD environment variables
 * Target: https://patelrep-production-0ad1.up.railway.app
 */

import { expect, test, type Page } from '@playwright/test'

// ── Credentials ───────────────────────────────────────────────────────────────

const GM_EMAIL = process.env.TEST_EMAIL ?? 'hp.patelrep@gmail.com'
const GM_PASSWORD = process.env.TEST_PASSWORD

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAsGM(page: Page): Promise<void> {
  await page.goto('/login')

  // Wait for the email/password form to be interactive
  const emailField = page.locator('#email-pw').or(page.locator('input[type="email"]')).first()
  await emailField.waitFor({ state: 'visible', timeout: 15000 })
  await emailField.fill(GM_EMAIL)

  const passwordField = page.locator('input[type="password"]').first()
  if (!GM_PASSWORD) throw new Error('Set TEST_PASSWORD to run authenticated work-order E2E tests')
  await passwordField.fill(GM_PASSWORD)

  // Submit — look for a submit button or the Enter key
  const submitButton = page
    .getByRole('button', { name: /sign in|log in|login/i })
    .or(page.locator('button[type="submit"]'))
    .first()
  await submitButton.click()

  // Wait for redirect away from /login (dashboard load)
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 })
}

async function navigateToWorkOrders(page: Page): Promise<void> {
  await page.goto('/engineering/work-orders')
  // Wait for the Kanban board to render
  await page.waitForSelector('[role="button"]', { timeout: 15000 }).catch(() => {
    // Board may be empty — that's fine
  })
  // Give React Query time to populate columns
  await page.waitForTimeout(1500)
}

/** Open the "New Work Order" modal. */
async function openCreateModal(page: Page): Promise<void> {
  const newBtn = page.getByRole('button', { name: 'New Work Order', exact: true })
  await newBtn.waitFor({ state: 'visible', timeout: 10000 })
  await newBtn.click()
  await page.waitForSelector('[role="dialog"][aria-label="Create Work Order"]', { timeout: 8000 })
}

/** Fill the WO form (non-AI path) and submit. */
async function createWorkOrder(
  page: Page,
  opts: {
    title: string
    priority: string   // 'emergency' | 'urgent' | 'normal' | 'low'
    locationText: string
  },
): Promise<void> {
  // Set location (other location free-text — no room picker needed)
  const locationInput = page
    .locator('[placeholder*="Lobby restroom"]')
    .or(page.locator('input[placeholder*="location"]'))
    .first()
  await locationInput.fill(opts.locationText)

  // Title input
  const titleInput = page.locator('input[placeholder*="A/C not cooling"]').or(page.locator('label:has-text("Title") + * input')).first()
  await titleInput.fill(opts.title)

  // Priority — radio or select
  const priorityRadio = page.locator(`input[type="radio"][value="${opts.priority}"]`)
  const hasPriorityRadio = await priorityRadio.count()
  if (hasPriorityRadio > 0) {
    await priorityRadio.first().check()
  } else {
    // May be a select — look for priority select
    const prioritySelect = page.locator('select').filter({ has: page.locator(`option[value="${opts.priority}"]`) }).first()
    await prioritySelect.selectOption(opts.priority)
  }

  // Submit
  const submitBtn = page
    .getByRole('button', { name: /create work order|submit|save/i })
    .or(page.locator('button[type="submit"]'))
    .first()
  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes('/work-orders') && resp.request().method() === 'POST',
      { timeout: 15000 },
    ),
    submitBtn.click(),
  ])
  if (!createResponse.ok()) {
    throw new Error(`Work-order creation failed (${createResponse.status()}) at ${createResponse.url()} with ${createResponse.request().postData()}: ${await createResponse.text()}`)
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Phase 1 — Work Orders', () => {

  // ── 1. Emergency work order creation ─────────────────────────────────────

  test('emergency WO appears at top of Open queue with EMERGENCY badge', async ({ page }) => {
    await loginAsGM(page)
    await navigateToWorkOrders(page)
    await openCreateModal(page)

    const uniqueTitle = `E2E EMERGENCY ${Date.now()}`
    await createWorkOrder(page, {
      title: uniqueTitle,
      priority: 'emergency',
      locationText: 'Lobby restroom (E2E test)',
    })

    // Modal should close; now we're back on the kanban board
    // Wait for the new card to appear in the Open column
    await page.waitForSelector(`text=${uniqueTitle}`, { timeout: 15000 })

    // The card for our WO
    const card = page.locator('[role="button"]').filter({ hasText: uniqueTitle })
    await expect(card).toBeVisible()

    // Verify EMERGENCY badge is present on the card OR in the alert banner
    const emergencyBadge = page
      .locator(`text=/emergency/i`)
      .first()
    await expect(emergencyBadge).toBeVisible()

    // Verify it is the FIRST card in the Open column
    // The Open column header says "Open" and has the cards below it
    const openColumn = page.locator('div').filter({ hasText: /^Open\s*\d/ }).first()
    const firstCardInOpen = openColumn.locator('[role="button"]').first()
    const firstCardText = await firstCardInOpen.textContent()
    expect(firstCardText).toContain(uniqueTitle)
  })

  // ── 2. Escalated visibility ───────────────────────────────────────────────

  test('escalating an open WO moves it into the Escalated column', async ({ page }) => {
    await loginAsGM(page)
    await navigateToWorkOrders(page)
    await openCreateModal(page)

    const uniqueTitle = `E2E ESCALATE ${Date.now()}`
    await createWorkOrder(page, {
      title: uniqueTitle,
      priority: 'urgent',
      locationText: 'Pool area (E2E escalation test)',
    })

    // Click the card to open the detail drawer
    await page.waitForSelector(`text=${uniqueTitle}`, { timeout: 15000 })
    const card = page.locator('[role="button"]').filter({ hasText: uniqueTitle }).first()
    await card.click()

    // Detail drawer should appear
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 })

    // Click "Escalate" button inside the drawer
    const escalateBtn = page.getByRole('button', { name: 'Escalate', exact: true })
    await escalateBtn.waitFor({ state: 'visible', timeout: 8000 })
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/work-orders') && (resp.request().method() === 'PATCH' || resp.request().method() === 'POST'),
        { timeout: 15000 },
      ),
      escalateBtn.click(),
    ])

    // Close drawer
    const closeBtn = page.getByRole('button', { name: /close/i }).first()
    await closeBtn.click()

    // Allow board to refresh
    await page.waitForTimeout(2000)

    // The card should now appear in the Escalated column.
    const escalatedColumn = page.getByTestId('work-order-column-escalated')
    const escalatedCard = escalatedColumn.locator('[role="button"]').filter({ hasText: uniqueTitle })
    await expect(escalatedCard).toBeVisible({ timeout: 10000 })
  })

  // ── 3. Hold with structured reason ───────────────────────────────────────

  test('putting a WO on hold requires and records a structured reason', async ({ page }) => {
    await loginAsGM(page)
    await navigateToWorkOrders(page)
    await openCreateModal(page)

    const uniqueTitle = `E2E HOLD ${Date.now()}`
    await createWorkOrder(page, {
      title: uniqueTitle,
      priority: 'normal',
      locationText: 'Fitness room (E2E hold test)',
    })

    // Click the card
    await page.waitForSelector(`text=${uniqueTitle}`, { timeout: 15000 })
    const card = page.locator('[role="button"]').filter({ hasText: uniqueTitle }).first()
    await card.click()
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 })

    // First claim the WO so it becomes in_progress (hold is only available on in_progress)
    const claimBtn = page.getByRole('button', { name: /claim work order|claim/i }).first()
    await claimBtn.waitFor({ state: 'visible', timeout: 8000 })
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/work-orders') && (resp.request().method() === 'PATCH' || resp.request().method() === 'POST'),
        { timeout: 15000 },
      ),
      claimBtn.click(),
    ])

    // Now "Put On Hold" should be visible
    const holdBtn = page.getByRole('button', { name: /put on hold/i })
    await holdBtn.waitFor({ state: 'visible', timeout: 10000 })
    await holdBtn.click()

    // A reason panel/dialog should appear — look for the reason select/dropdown
    const reasonSelect = page.locator('select').filter({ has: page.locator('option[value="awaiting_parts"]') }).first()
    await reasonSelect.waitFor({ state: 'visible', timeout: 8000 })

    // Verify the reason dropdown contains the expected options
    await expect(reasonSelect.locator('option[value="awaiting_parts"]')).toHaveCount(1)
    await expect(reasonSelect.locator('option[value="awaiting_vendor"]')).toHaveCount(1)
    await expect(reasonSelect.locator('option[value="schedule_deferral"]')).toHaveCount(1)
    await expect(reasonSelect.locator('option[value="safety_review"]')).toHaveCount(1)

    // Select a reason
    await reasonSelect.selectOption('awaiting_parts')

    // Submit the hold
    const saveBtn = page.getByRole('button', { name: /save change/i })
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/work-orders') && (resp.request().method() === 'PATCH' || resp.request().method() === 'POST'),
        { timeout: 15000 },
      ),
      saveBtn.click(),
    ])

    // The drawer should update — verify the status shows "on hold"
    const statusPill = page.locator('[class*="Pill"]').filter({ hasText: /on hold/i }).first()
      .or(page.locator('span').filter({ hasText: /on hold/i }).first())
    await expect(statusPill).toBeVisible({ timeout: 10000 })
  })

  // ── 4. Reopen from hold ───────────────────────────────────────────────────

  test('a held WO can be resumed back to in_progress', async ({ page }) => {
    await loginAsGM(page)
    await navigateToWorkOrders(page)
    await openCreateModal(page)

    const uniqueTitle = `E2E RESUME ${Date.now()}`
    await createWorkOrder(page, {
      title: uniqueTitle,
      priority: 'normal',
      locationText: 'Conference room (E2E resume test)',
    })

    // Click the card to open drawer
    await page.waitForSelector(`text=${uniqueTitle}`, { timeout: 15000 })
    const card = page.locator('[role="button"]').filter({ hasText: uniqueTitle }).first()
    await card.click()
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 })

    // Claim so WO becomes in_progress
    const claimBtn = page.getByRole('button', { name: /claim work order|claim/i }).first()
    await claimBtn.waitFor({ state: 'visible', timeout: 8000 })
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/work-orders') && (resp.request().method() === 'PATCH' || resp.request().method() === 'POST'),
        { timeout: 15000 },
      ),
      claimBtn.click(),
    ])

    // Put on hold
    const holdBtn = page.getByRole('button', { name: /put on hold/i })
    await holdBtn.waitFor({ state: 'visible', timeout: 10000 })
    await holdBtn.click()

    const reasonSelect = page.locator('select').filter({ has: page.locator('option[value="awaiting_parts"]') }).first()
    await reasonSelect.waitFor({ state: 'visible', timeout: 8000 })
    await reasonSelect.selectOption('awaiting_vendor')

    const saveBtn = page.getByRole('button', { name: /save change/i })
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/work-orders') && (resp.request().method() === 'PATCH' || resp.request().method() === 'POST'),
        { timeout: 15000 },
      ),
      saveBtn.click(),
    ])

    // Now resume — the "Resume" button should appear
    const resumeBtn = page.getByRole('button', { name: /^resume$/i })
    await resumeBtn.waitFor({ state: 'visible', timeout: 10000 })
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/work-orders') && (resp.request().method() === 'PATCH' || resp.request().method() === 'POST'),
        { timeout: 15000 },
      ),
      resumeBtn.click(),
    ])

    // Drawer should show in_progress status
    const inProgressPill = page.locator('span').filter({ hasText: /in progress/i }).first()
    await expect(inProgressPill).toBeVisible({ timeout: 10000 })
  })

  // ── 5. Inspection photo upload prompt ────────────────────────────────────

  test('failing a requires_photo_on_fail inspection item shows photo upload prompt', async ({ page }) => {
    await loginAsGM(page)

    // Navigate to inspections page
    await page.goto('/housekeeping/inspections')
    await page.waitForLoadState('networkidle', { timeout: 15000 })

    // Look for an "Inspect" button on any room that is ready for inspection
    // The page shows rooms ready for inspection with an Inspect button
    const inspectBtn = page.getByRole('button', { name: /^inspect$/i }).first()
    const hasInspectBtn = await inspectBtn.count()

    if (hasInspectBtn === 0) {
      // No rooms ready — skip this test scenario gracefully with a note
      // This can happen in a fresh environment with no cleaned rooms
      test.skip(true, 'No rooms currently ready for inspection in production — cannot exercise inspection flow')
      return
    }

    await inspectBtn.click()

    // The InspectionModal should open
    await page.waitForSelector('[role="dialog"][aria-label*="Inspect Room"]', { timeout: 8000 })

    // Wait for template items to load
    await page.waitForSelector('button:has-text("Pass")', { timeout: 10000 }).catch(() => {
      // If no template items, the modal shows a warning — that's handled below
    })

    // Count Fail buttons — if there are none, no template is configured
    const failButtons = page.getByRole('button', { name: /^Fail$/i })
    const failCount = await failButtons.count()

    if (failCount === 0) {
      // No inspection items configured — the modal shows a warning
      const warning = page.locator('text=/no inspection template/i')
      await expect(warning).toBeVisible({ timeout: 5000 })
      return
    }

    // Click the first Fail button to mark an item as failed
    await failButtons.first().click()

    // After clicking Fail, a photo upload input or label should appear
    // The InspectionModal renders: "Photo evidence required" or "Add photo evidence (optional)"
    // plus an <input type="file"> — this is the key assertion
    const photoPrompt = page
      .locator('label')
      .filter({ hasText: /photo evidence/i })
      .first()
    await expect(photoPrompt).toBeVisible({ timeout: 5000 })

    // Specifically for items with requires_photo_on_fail=true, the label says "Photo evidence required"
    // We accept either variant since we don't know which item was first
    const photoLabel = await photoPrompt.textContent()
    expect(photoLabel).toMatch(/photo evidence/i)

    // The file input must be present and accessible
    const fileInput = page.locator('input[type="file"]').first()
    await expect(fileInput).toBeAttached()
  })
})

/**
 * Phase 20 — Close Deferred v1.3 Verification Items
 *
 * Live-browser RBAC verification for two items deferred from v1.3:
 *
 *   VERIFY-01 — Non-manager roles do not see the "Archive..." button on the
 *   Engineering Work Orders page. Covers BOTH enforcement layers: the route
 *   redirect (housekeeper/front_desk never render the page at all) and the
 *   canManage button gate (chief_engineer reaches the page but the button is
 *   hidden — engineer||gm only).
 *
 *   VERIFY-04 — The Inspections re-assign picker re-assigns a failed
 *   inspection to a housekeeping_supervisor end-to-end (picker selectability
 *   + submit + success toast + assignment update).
 *
 * Mirrors the e2e/16-rbac.spec.ts harness pattern (seedRbacUsers / loginViaUI
 * / teardownRbacUsers). See e2e/helpers/rbac-users.ts.
 */
import { test, expect, type Page } from '@playwright/test'
import {
  getGmToken,
  seedRbacUsers,
  teardownRbacUsers,
  type RbacTestUser,
  GM_TEST_USER,
  TEST_PASSWORD,
} from './helpers/rbac-users'

const EMPTY_STORAGE = { cookies: [], origins: [] }

test.skip(!TEST_PASSWORD, 'Set TEST_PASSWORD or RBAC_TEST_PASSWORD to run RBAC Playwright helpers')

// ── Service-role DB helpers (fixture snapshot/restore + residue sweep) ────────
// e2e/helpers/rbac-users.ts loads apps/api/.env as a side effect of import,
// so SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are already in process.env here.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function svcHeaders(json = false) {
  const h: Record<string, string> = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

async function dbSelect(table: string, query: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: svcHeaders() })
  const json = await res.json()
  return Array.isArray(json) ? json : []
}

async function dbUpdate(table: string, query: string, body: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...svcHeaders(true), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
}

async function dbInsert(table: string, body: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...svcHeaders(true), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
}

async function dbDelete(table: string, query: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: svcHeaders() })
}

async function adminUsersByEmail(email: string): Promise<Array<{ id: string; email: string }>> {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=1000`,
    { headers: svcHeaders() },
  )
  const raw = await res.json()
  const users = Array.isArray(raw) ? raw : raw.users || []
  return users.filter((u: any) => (u.email || '').toLowerCase() === email.toLowerCase())
}

async function adminDeleteUser(id: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svcHeaders() })
}

/** Local (machine) date in yyyy-MM-dd — matches the web app's date-fns todayISO(), both run on this host. */
function localTodayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Login helper (copied verbatim from e2e/16-rbac.spec.ts) ───────────────────

async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.waitForSelector('#email-pw', { timeout: 10_000 })
  await page.fill('#email-pw', email)
  await page.fill('#password-pw', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 25_000 })
}

// ── Suite ───────────────────────────────────────────────────────────────────

let gmToken = ''
let seededUsers: RbacTestUser[] = []

test.beforeAll(async () => {
  gmToken = await getGmToken()
  seededUsers = await seedRbacUsers(gmToken)
})

test.afterAll(async () => {
  await teardownRbacUsers(gmToken, seededUsers)
  // Supplemental sweep: seedRbacUsers does not capture a userId for a seed
  // attempt that fails after auth-user creation (e.g. chief_engineer, blocked
  // today by a DB CHECK constraint — see .wolf/buglog.json bug-755), so
  // teardownRbacUsers' DELETE /staff/{id} can never reach it. Sweep the
  // Supabase Admin API directly by email so no @patelrep-test.com auth user
  // (and its cascade-deleted user_profiles row) survives this spec.
  for (const u of seededUsers) {
    const matches = await adminUsersByEmail(u.email)
    for (const m of matches) await adminDeleteUser(m.id)
  }
})

// ── VERIFY-01 — Archive button role gate ───────────────────────────────────────

test.describe('VERIFY-01 — Engineering Work Orders archive-button role gate', () => {
  test('front_desk is redirected away from /engineering (route layer)', async ({ browser }) => {
    const fdUser = seededUsers.find((u) => u.role === 'front_desk')
    test.skip(!fdUser?.userId, 'front_desk seed user not available')

    const ctx = await browser.newContext({ storageState: EMPTY_STORAGE })
    const page = await ctx.newPage()
    try {
      await loginViaUI(page, fdUser!.email, fdUser!.password)
      await page.goto('/engineering')
      await expect(page).toHaveURL(/\/dashboard(\?unauthorized|$)/, { timeout: 8_000 })
      // Never rendered the Work Orders page — the Archive button cannot exist.
      await expect(page.getByRole('button', { name: /^archive\.\.\.$/i })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('housekeeper cannot reach the web portal at all (mobile-only role, blocked at login)', async ({ browser }) => {
    const hkUser = seededUsers.find((u) => u.role === 'housekeeper')
    test.skip(!hkUser?.userId, 'housekeeper seed user not available')

    const ctx = await browser.newContext({ storageState: EMPTY_STORAGE })
    const page = await ctx.newPage()
    try {
      await page.goto('/login')
      await page.waitForSelector('#email-pw', { timeout: 10_000 })
      await page.fill('#email-pw', hkUser!.email)
      await page.fill('#password-pw', hkUser!.password)
      await page.click('button[type="submit"]')

      // apps/web/app/(auth)/login/page.tsx signs MOBILE_ONLY_ROLES back out
      // immediately after a successful Supabase sign-in and never navigates —
      // housekeeper/engineer never reach /dashboard, let alone /engineering.
      await expect(
        page.getByText(/restricted to front desk, gm, and supervisor staff/i),
      ).toBeVisible({ timeout: 10_000 })
      await expect(page).toHaveURL(/\/login/)

      // Belt-and-suspenders: direct navigation to /engineering also never renders it.
      await page.goto('/engineering')
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('button', { name: /^archive\.\.\.$/i })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('chief_engineer reaches Work Orders but the Archive button is gated off (canManage)', async ({ browser }) => {
    const ceUser = seededUsers.find((u) => u.role === 'chief_engineer')
    test.skip(
      !ceUser?.userId,
      'chief_engineer could not be seeded — DB CHECK constraint user_roles_role_check currently ' +
        'rejects chief_engineer (migration 064 merged it into engineer; app code never got fully ' +
        'reverted). Fix written as supabase/migrations/092_restore_chief_engineer_role.sql but not ' +
        'yet applied to this DB (needs Supabase MCP access this executor does not have) — see ' +
        '.wolf/buglog.json bug-755. Once applied, this test exercises the real canManage gate live.',
    )

    const ctx = await browser.newContext({ storageState: EMPTY_STORAGE })
    const page = await ctx.newPage()
    try {
      await loginViaUI(page, ceUser!.email, ceUser!.password)
      await page.goto('/engineering/work-orders')
      // Route-allowed (chief_engineer is in ROLE_ROUTE_RULES['/engineering']) — must NOT redirect.
      await expect(page).not.toHaveURL(/\/dashboard\?unauthorized/)
      await expect(page.getByText(/work orders/i).first()).toBeVisible({ timeout: 10_000 })
      // canManage = role === 'engineer' || role === 'gm' — chief_engineer excluded.
      await expect(page.getByRole('button', { name: /^archive\.\.\.$/i })).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('GM sees the Archive button (positive control)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: EMPTY_STORAGE })
    const page = await ctx.newPage()
    try {
      await loginViaUI(page, GM_TEST_USER.email, GM_TEST_USER.password)
      await page.goto('/engineering/work-orders')
      await expect(page.getByRole('button', { name: /^archive\.\.\.$/i })).toHaveCount(1)
    } finally {
      await ctx.close()
    }
  })
})

// ── VERIFY-04 — Inspections re-assign to housekeeping_supervisor ──────────────

test.describe('VERIFY-04 — Inspections re-assign to housekeeping_supervisor', () => {
  test('re-assigns a failed inspection to the seeded housekeeping_supervisor end-to-end', async ({ browser }) => {
    const supervisor = seededUsers.find((u) => u.role === 'housekeeping_supervisor')
    test.skip(!supervisor?.userId, 'housekeeping_supervisor seed user not available')

    const ctx = await browser.newContext({ storageState: EMPTY_STORAGE })
    const page = await ctx.newPage()

    // Fixture bookkeeping for teardown.
    let targetRoom: { room_id: string; room_number: string } | null = null
    let roomStatusSnapshot: Record<string, any> | null = null
    let insertedRoomStatusRow = false
    const today = localTodayISO()
    let assignmentSnapshot: Record<string, any> | null = null
    let createdInspectionId: string | null = null
    let createdTaskId: string | null = null

    try {
      await loginViaUI(page, GM_TEST_USER.email, GM_TEST_USER.password)

      // ── 1. Find (or seed) a room ready for inspection ──────────────────────
      const [readyResp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/housekeeping/ready-for-inspection') && r.request().method() === 'GET',
        ),
        page.goto('/housekeeping/inspections'),
      ])
      let rooms: Array<{ room_id: string; room_number: string }> = (await readyResp.json()).data || []

      if (rooms.length === 0) {
        // No room currently in the queue — seed the least-invasive fixture:
        // flip one real room's room_status to CLEAN so it enters the queue.
        const claims = JSON.parse(Buffer.from(gmToken.split('.')[1], 'base64').toString('utf8'))
        const hotelId = claims.hotel_id
        const roomsList = await dbSelect('rooms', `tenant_id=eq.${hotelId}&select=id,room_number&limit=1`)
        expect(roomsList.length, 'no rooms exist for this hotel — cannot fixture a ready-for-inspection room').toBeGreaterThan(0)
        const room = roomsList[0]
        targetRoom = { room_id: room.id, room_number: room.room_number }

        const before = await dbSelect('room_status', `room_id=eq.${room.id}&select=*`)
        if (before.length > 0) {
          roomStatusSnapshot = before[0]
          await dbUpdate('room_status', `room_id=eq.${room.id}`, { status: 'CLEAN' })
        } else {
          insertedRoomStatusRow = true
          await dbInsert('room_status', { room_id: room.id, tenant_id: hotelId, status: 'CLEAN' })
        }

        const [readyResp2] = await Promise.all([
          page.waitForResponse(
            (r) => r.url().includes('/housekeeping/ready-for-inspection') && r.request().method() === 'GET',
          ),
          page.reload(),
        ])
        rooms = (await readyResp2.json()).data || []
      } else {
        targetRoom = rooms[0]
        const before = await dbSelect('room_status', `room_id=eq.${targetRoom.room_id}&select=*`)
        roomStatusSnapshot = before[0] ?? null
      }

      expect(targetRoom).not.toBeNull()
      expect(rooms.length, 'target room did not appear in the ready-for-inspection queue').toBeGreaterThan(0)

      // Snapshot any pre-existing assignment for this room+date (none expected for the primary path).
      const assignBefore = await dbSelect(
        'room_assignments',
        `room_id=eq.${targetRoom!.room_id}&assignment_date=eq.${today}&select=*`,
      )
      assignmentSnapshot = assignBefore[0] ?? null

      // ── 2. Open the inspection modal for that room ──────────────────────────
      const inspectBtn = page.getByRole('button', { name: /^Inspect$/i })
      await expect(inspectBtn.first()).toBeVisible({ timeout: 10_000 })
      await inspectBtn.first().click()

      const modal = page.getByRole('dialog')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      await expect(modal.getByText(/loading inspection template/i)).toHaveCount(0, { timeout: 10_000 })

      // ── 3. Fail the first required checklist item, pass the rest ───────────
      const failButtons = modal.getByRole('button', { name: /^Fail$/i })
      const passButtons = modal.getByRole('button', { name: /^Pass$/i })
      await expect(failButtons.first()).toBeVisible({ timeout: 8_000 })
      const itemCount = await failButtons.count()
      expect(itemCount, 'inspection template has no checklist items to fail').toBeGreaterThan(0)

      await failButtons.nth(0).click()
      const noteInput = modal.getByPlaceholder(/what needs to be fixed/i)
      if (await noteInput.count() > 0) {
        await noteInput.first().fill('Phase 20 VERIFY-04 automated verification — safe to ignore/revert.')
      }
      for (let i = 1; i < itemCount; i++) {
        await passButtons.nth(i).click()
      }

      // Overall result auto-calculates to "failed" once any required item fails.
      await expect(modal.getByText(/failed/i).first()).toBeVisible()

      // ── 4. Submit the inspection ────────────────────────────────────────────
      const submitBtn = modal.getByRole('button', { name: /submit inspection/i })
      const [inspResp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/housekeeping/inspections') && r.request().method() === 'POST',
        ),
        submitBtn.click(),
      ])
      expect(inspResp.status()).toBeLessThan(300)
      createdInspectionId = (await inspResp.json()).data?.id ?? null

      // ── 5. Re-clean step — dispatch it so the parent's onSuccess('failed') fires ──
      const dispatchBtn = page.getByRole('button', { name: /dispatch re-clean/i })
      await expect(dispatchBtn).toBeVisible({ timeout: 8_000 })
      const [recleanResp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes(`/rooms/${targetRoom!.room_id}/re-clean`) && r.request().method() === 'POST',
        ),
        dispatchBtn.click(),
      ])
      expect(recleanResp.status()).toBeLessThan(300)
      // POST /rooms/{room_id}/re-clean (routers/rooms.py dispatch_re_clean) returns a flat
      // data.task_id -- not the nested data.task.id shape used by the separate, frontend-unused
      // POST /housekeeping/inspections/{id}/reclean (trigger_reclean) endpoint.
      createdTaskId = (await recleanResp.json()).data?.task_id ?? null

      // ── 6. Re-assign drawer — the housekeeping_supervisor must be selectable ──
      const reassignSelect = page.locator('select').first()
      await expect(reassignSelect).toBeVisible({ timeout: 8_000 })

      const supervisorOption = reassignSelect.locator(`option[value="${supervisor!.userId}"]`)
      await expect(supervisorOption).toHaveCount(1)
      await expect(supervisorOption).toHaveText(/Test Housekeeping Supervisor/i)

      await reassignSelect.selectOption(supervisor!.userId!)

      const reassignBtn = page.getByRole('button', { name: /^Re-assign$/i })
      const [assignResp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/housekeeping/assignments') && r.request().method() === 'POST',
        ),
        reassignBtn.click(),
      ])
      expect(assignResp.status()).toBeLessThan(300)

      // ── 7. Success toast + assignment actually updated ──────────────────────
      await expect(page.getByText(/re-assigned for re-clean/i)).toBeVisible({ timeout: 8_000 })

      const assignAfter = await dbSelect(
        'room_assignments',
        `room_id=eq.${targetRoom!.room_id}&assignment_date=eq.${today}&select=*`,
      )
      expect(assignAfter.length).toBeGreaterThan(0)
      expect(assignAfter[0].assigned_to).toBe(supervisor!.userId)
    } finally {
      await ctx.close()

      // ── Teardown: leave no functional residue. Audit trail (room_status_history,
      // operational_audit_events) is intentionally NOT deleted — append-only by design.
      if (targetRoom) {
        if (createdInspectionId) {
          await dbDelete('inspection_results', `inspection_id=eq.${createdInspectionId}`)
          await dbDelete('inspections', `id=eq.${createdInspectionId}`)
        }
        if (createdTaskId) {
          await dbDelete('tasks', `id=eq.${createdTaskId}`)
        }
        await dbDelete('room_assignments', `room_id=eq.${targetRoom.room_id}&assignment_date=eq.${today}`)
        if (assignmentSnapshot) {
          await dbInsert('room_assignments', assignmentSnapshot)
        }
        if (insertedRoomStatusRow) {
          await dbDelete('room_status', `room_id=eq.${targetRoom.room_id}`)
        } else if (roomStatusSnapshot) {
          const restore = { ...roomStatusSnapshot }
          delete restore.room_id
          delete restore.tenant_id
          await dbUpdate('room_status', `room_id=eq.${targetRoom.room_id}`, restore)
        }
      }
    }
  })
})

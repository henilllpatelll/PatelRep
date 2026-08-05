/**
 * Phase 20 — Close Deferred v1.3 Verification Items (Plan 02)
 *
 *   VERIFY-02 — A NULL/empty staff `full_name` renders the "Unnamed Staff"
 *   fallback (apps/web/lib/utils/avatar.ts getDisplayName) across the Staff,
 *   Scheduling, and Housekeeping pages, with zero browser console errors.
 *
 *   VERIFY-03 — The Guest Request drawer's per-status advance buttons click
 *   through the legal status chain (open -> acknowledged -> dispatched ->
 *   arrived -> guest_contacted -> resolved -> verified) end-to-end, and the
 *   kanban board reflects the new status after each click.
 *
 * Both checks run as the durable GM test account (single-role checks per
 * 20-RESEARCH.md). Mirrors the e2e/20-verify-rbac.spec.ts service-role DB
 * helper pattern for seeding/tearing down fixtures directly against Supabase.
 */
import { test, expect, type Page } from '@playwright/test'
import { getGmToken, GM_TEST_USER, TEST_PASSWORD, API_URL } from './helpers/rbac-users'

const EMPTY_STORAGE = { cookies: [], origins: [] }

test.skip(!TEST_PASSWORD, 'Set TEST_PASSWORD or RBAC_TEST_PASSWORD to run this Playwright spec')

// ── Service-role DB helpers (fixture seed/restore) ────────────────────────────
// e2e/helpers/rbac-users.ts loads apps/api/.env as a side effect of import, so
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are already in process.env here.
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

function decodeJwtHotelId(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
  return payload.hotel_id
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

// ── Shared GM token ─────────────────────────────────────────────────────────

let gmToken = ''
let hotelId = ''

test.beforeAll(async () => {
  gmToken = await getGmToken()
  hotelId = decodeJwtHotelId(gmToken)
})

// ── VERIFY-02 — NULL full_name renders "Unnamed Staff" everywhere ─────────────

test.describe('VERIFY-02 — NULL full_name renders "Unnamed Staff" fallback', () => {
  const seedEmail = 'verify02-unnamed-staff@patelrep-test.com'
  let seededUserId: string | null = null
  let shiftAssignmentId: string | null = null

  test.beforeAll(async () => {
    // 1. Seed a real staff user (role=housekeeper, so it also surfaces on the
    //    Housekeeping page's assign-bar chip list, which filters to
    //    housekeeper/housekeeping_supervisor only).
    const res = await fetch(`${API_URL}/v1/staff/add-direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({
        email: seedEmail,
        password: TEST_PASSWORD,
        role: 'housekeeper',
        full_name: 'Verify02 Temp Name',
      }),
    })
    if (res.ok) {
      const json = await res.json()
      seededUserId = json.data?.user_id ?? null
    } else {
      console.warn(`[VERIFY-02 seed] add-direct failed: ${res.status} ${await res.text()}`)
    }
    if (!seededUserId) return

    // 2. Blank the profile's full_name directly (the fallback only renders on a
    //    genuinely null/empty name — 20-RESEARCH.md Pitfall 3). user_profiles.full_name
    //    is a NOT NULL column (migration 003) so an empty string is the only DB-valid
    //    way to reach this state — matches the exact `profile.get("full_name") or ""`
    //    fallback condition in apps/api/routers/staff.py.
    await dbUpdate('user_profiles', `id=eq.${seededUserId}`, { full_name: '' })

    // 3. Seed a shift_assignments row for TODAY so the Scheduling page's
    //    Today's Roster panel picks this user up (roster is driven by
    //    shift_assignments, not just staff existing).
    const shifts = await dbSelect('shifts', `tenant_id=eq.${hotelId}&select=id&limit=1`)
    if (shifts.length > 0) {
      const shiftId = shifts[0].id
      const today = localTodayISO()
      await dbInsert('shift_assignments', {
        tenant_id: hotelId,
        user_id: seededUserId,
        shift_id: shiftId,
        work_date: today,
        is_on_shift: true,
      })
      const rows = await dbSelect(
        'shift_assignments',
        `user_id=eq.${seededUserId}&shift_id=eq.${shiftId}&work_date=eq.${today}&select=id`,
      )
      shiftAssignmentId = rows[0]?.id ?? null
    } else {
      console.warn('[VERIFY-02 seed] no shifts exist for this hotel — scheduling roster fixture skipped')
    }
  })

  test.afterAll(async () => {
    if (shiftAssignmentId) {
      await dbDelete('shift_assignments', `id=eq.${shiftAssignmentId}`)
    }
    if (seededUserId) {
      await fetch(`${API_URL}/v1/staff/${seededUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${gmToken}` },
      })
    }
    // Supplemental sweep by email — mirrors 20-verify-rbac.spec.ts, in case
    // add-direct created the auth user but seededUserId was never captured.
    const matches = await adminUsersByEmail(seedEmail)
    for (const m of matches) await adminDeleteUser(m.id)
  })

  test('NULL full_name renders "Unnamed Staff" on Staff, Scheduling, and Housekeeping with zero console errors', async ({ browser }) => {
    test.skip(!seededUserId, 'VERIFY-02 staff fixture could not be seeded')

    const ctx = await browser.newContext({ storageState: EMPTY_STORAGE })
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
    })
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))

    try {
      await loginViaUI(page, GM_TEST_USER.email, GM_TEST_USER.password)

      // Staff page — main list row (staff/page.tsx:921/923), no modal needed.
      await page.goto('/staff')
      await expect(page.getByText('Unnamed Staff').first()).toBeVisible({ timeout: 10_000 })

      // Housekeeping page — assign-bar chip list only renders in Assign mode.
      // The chip itself shows only the first word of getDisplayName() (space-constrained
      // UI, same `.split(' ')[0]` pattern staff/page.tsx:587 uses elsewhere), so "Unnamed
      // Staff" truncates to "Unnamed" here — assert on the chip button's accessible name
      // (initials "US" + first word "Unnamed"), not the literal full fallback string.
      await page.goto('/housekeeping')
      await page.getByRole('button', { name: /^Assign mode$/i }).click()
      await expect(page.getByTestId('hk-chip-list')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByTestId('hk-chip-list').getByRole('button', { name: /unnamed/i })).toBeVisible({ timeout: 10_000 })

      // Scheduling page — Today's Roster panel (now fixed, see bug-764).
      await page.goto('/scheduling')
      await expect(page.getByText("Today's Roster")).toBeVisible({ timeout: 10_000 })
      await expect(page.getByText('Unnamed Staff').first()).toBeVisible({ timeout: 10_000 })

      expect(errors, `console/page errors found: ${errors.join(' | ')}`).toHaveLength(0)
    } finally {
      await ctx.close()
    }
  })
})

// ── VERIFY-03 — Guest Request drawer advance chain + kanban reflects status ───

test.describe('VERIFY-03 — Guest Request drawer advance chain + kanban reflect', () => {
  test('drawer advances a request through the full legal chain; kanban reflects each status', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: EMPTY_STORAGE })
    const page = await ctx.newPage()

    let createdRequestId: string | null = null
    const marker = `Phase 20 VERIFY-03 e2e ${Date.now()} — safe to ignore/delete`

    try {
      await loginViaUI(page, GM_TEST_USER.email, GM_TEST_USER.password)

      // Wait for the kanban's initial data load (not just DOM presence) before
      // interacting — clicking "New Request" immediately after goto() can race
      // React hydration attaching the button's onClick handler.
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/guest-requests') && r.request().method() === 'GET' && !r.url().includes('/messages'),
        ),
        page.goto('/guest-requests'),
      ])

      // ── 1. Create one guest request via the real product create path ─────
      const newRequestBtn = page.getByRole('button', { name: /^New Request$/i })
      await expect(newRequestBtn).toBeVisible({ timeout: 10_000 })
      const createModal = page.getByRole('dialog', { name: /new guest request/i })
      // Retry the click: Next.js dev-mode on-demand compilation can leave the
      // button visible in the DOM slightly before React finishes hydrating and
      // attaching its onClick handler, so a single click can silently no-op.
      let modalOpened = false
      for (let attempt = 0; attempt < 5 && !modalOpened; attempt++) {
        await newRequestBtn.click()
        try {
          await expect(createModal).toBeVisible({ timeout: 2_000 })
          modalOpened = true
        } catch {
          // not yet — retry
        }
      }
      expect(modalOpened, 'New Request modal never opened after retries').toBe(true)

      const roomInput = createModal.getByPlaceholder(/type or select room/i)
      await roomInput.click()
      const firstRoomOption = createModal.locator('button', { hasText: /^Room / }).first()
      await expect(firstRoomOption).toBeVisible({ timeout: 8_000 })
      await firstRoomOption.click()

      await createModal.getByPlaceholder(/what does the guest need/i).fill(marker)

      const [createResp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/guest-requests') && r.request().method() === 'POST' && !r.url().includes('/messages'),
        ),
        createModal.getByRole('button', { name: /^Create Request$/i }).click(),
      ])
      expect(createResp.status()).toBeLessThan(300)
      createdRequestId = (await createResp.json()).data?.id ?? null
      expect(createdRequestId, 'guest request create did not return an id').toBeTruthy()

      // ── 2. Card appears in the Open column ────────────────────────────────
      const openColumn = page.getByTestId('gr-column-open')
      await expect(openColumn.getByText(marker).first()).toBeVisible({ timeout: 10_000 })

      // ── 3. Open the drawer once, then walk the full legal chain ───────────
      await openColumn.getByText(marker).first().click()
      const drawer = page.getByRole('dialog', { name: /guest request/i })
      await expect(drawer).toBeVisible({ timeout: 8_000 })

      const steps: Array<{ button: RegExp; nextStatus: string; column: 'open' | 'acknowledged' | 'resolved_today' | null }> = [
        { button: /^Acknowledge$/, nextStatus: 'acknowledged', column: 'acknowledged' },
        { button: /^Dispatch$/, nextStatus: 'dispatched', column: 'acknowledged' },
        { button: /^Arrived$/, nextStatus: 'arrived', column: 'acknowledged' },
        { button: /^Contacted$/, nextStatus: 'guest_contacted', column: 'acknowledged' },
        { button: /^Resolve$/, nextStatus: 'resolved', column: 'resolved_today' },
        { button: /^Verify$/, nextStatus: 'verified', column: null },
      ]

      for (const step of steps) {
        const advanceBtn = drawer.getByRole('button', { name: step.button })
        await expect(advanceBtn).toBeVisible({ timeout: 8_000 })
        const [transitionResp] = await Promise.all([
          page.waitForResponse(
            (r) => r.url().includes(`/guest-requests/${createdRequestId}/transition`) && r.request().method() === 'POST',
          ),
          advanceBtn.click(),
        ])
        expect(transitionResp.status(), `transition to ${step.nextStatus} failed`).toBeLessThan(300)
        const body = await transitionResp.json()
        expect(body.data?.status).toBe(step.nextStatus)

        if (step.column) {
          await expect(page.getByTestId(`gr-column-${step.column}`).getByText(marker).first()).toBeVisible({ timeout: 8_000 })
        } else {
          // 'verified' has no kanban bucket (COLUMNS only covers open/acknowledged.../resolved) —
          // reflecting the new status means the card leaves the board entirely.
          await expect(page.getByTestId('gr-column-open').getByText(marker)).toHaveCount(0)
          await expect(page.getByTestId('gr-column-acknowledged').getByText(marker)).toHaveCount(0)
          await expect(page.getByTestId('gr-column-resolved_today').getByText(marker)).toHaveCount(0)
        }
      }
    } finally {
      await ctx.close()
      if (createdRequestId) {
        // DELETE /guest-requests/{id} is currently blocked by a pre-existing DB
        // constraint (guest_request_events.guest_request_id was ON DELETE RESTRICT,
        // and every request gets a "created" event at creation, so this endpoint has
        // never successfully deleted anything) — fixed at the source via
        // supabase/migrations/093_guest_requests_delete_cascade.sql (written, not yet
        // applied; same escalation pattern as migration 092 in 20-01). Attempt the
        // real teardown call (forward-compatible — starts working once 093 lands) but
        // don't fail this test on the pending-migration gap; warn instead so it's
        // never silently swallowed. See .wolf/buglog.json.
        const delResp = await fetch(`${API_URL}/v1/guest-requests/${createdRequestId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${gmToken}` },
        })
        if (!delResp.ok) {
          console.warn(
            `[VERIFY-03 teardown] DELETE /guest-requests/${createdRequestId} returned ${delResp.status} ` +
              `— likely still blocked pending migration 093. Residual row title marker: "${marker}".`,
          )
        }
      }
    }
  })
})

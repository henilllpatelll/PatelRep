/**
 * Golden path: Lost & Found Phase 4 — returns, disposition, void.
 *
 * Covers the contract behaviors that aren't exercised by the Phase 1
 * suites (e2e/11-lost-found.spec.ts, e2e/golden-paths/lost-found.spec.ts):
 *   - prepare-return duplicate guard (409 on a second active return)
 *   - full pickup return completion, through the UI
 *   - full shipping return completion, through the UI
 *   - disposition queue excludes matched/actively-returning items
 *   - void is blocked once an item reaches a terminal status
 *   - front_desk cannot approve disposition or void a record
 *
 * Item/claim/match setup goes through the API directly (service-role-free,
 * GM bearer token) rather than the UI — it's the same backend contract the
 * UI calls, and keeping setup out of the browser keeps these tests fast and
 * deterministic. The two full-return flows exercise the real UI, mirroring
 * e2e/golden-paths/tasks.spec.ts's waitForResponse + role-locator pattern.
 */
import { test, expect } from '@playwright/test'
import {
  getGmToken,
  seedRbacUsers,
  teardownRbacUsers,
  type RbacTestUser,
  TEST_PASSWORD,
  API_URL,
} from '../helpers/rbac-users'

test.skip(!TEST_PASSWORD, 'Set TEST_PASSWORD or RBAC_TEST_PASSWORD to run Lost & Found Phase 4 Playwright tests')

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function svcHeaders(json = false) {
  const h: Record<string, string> = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

/** Direct DB patch for states the API deliberately has no endpoint for
 * (backdating a retention deadline, forcing a terminal status for the void
 * guard) — mirrors e2e/20-verify-rbac.spec.ts's dbUpdate helper. */
async function dbUpdateItem(itemId: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lost_found_items?id=eq.${itemId}`, {
    method: 'PATCH',
    headers: { ...svcHeaders(true), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`dbUpdateItem failed: ${res.status} ${await res.text()}`)
}

let gmToken = ''

async function api(path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gmToken}`,
      ...(init.headers || {}),
    },
  })
}

/** Reads the body exactly once — `expect(status, await res.text())` followed
 * by `res.json()` throws ("Body is unusable") since fetch bodies are
 * single-read streams. Assert success and parse from the same string. */
async function jsonOk(res: Response): Promise<any> {
  const text = await res.text()
  expect(res.status, text).toBeLessThan(300)
  return text ? JSON.parse(text) : {}
}

async function createItem(description: string) {
  const res = await api('/lost-found', {
    method: 'POST',
    body: JSON.stringify({
      description,
      location_found: 'Lobby',
      storage_location: 'Lost & Found Room',
      category: 'other',
    }),
  })
  return (await jsonOk(res)).data
}

async function createClaim(description: string) {
  const res = await api('/lost-found/claims', {
    method: 'POST',
    body: JSON.stringify({
      guest_name: `E2E Phase4 Guest ${Date.now()}`,
      description,
      category: 'other',
    }),
  })
  return (await jsonOk(res)).data
}

/** Create a matched item+claim pair in one call — the precondition for
 * prepare-return, the disposition-eligibility exclusion, etc. */
async function createMatchedPair(label: string) {
  const item = await createItem(`E2E ${label} item ${Date.now()}`)
  const claim = await createClaim(item.description)
  const matchRes = await api(`/lost-found/claims/${claim.id}/match`, {
    method: 'POST',
    body: JSON.stringify({ item_id: item.id, verification_notes: 'E2E verification notes' }),
  })
  await jsonOk(matchRes)
  return { item, claim }
}

test.beforeAll(async () => {
  gmToken = await getGmToken()
})

test.describe('Lost & Found Phase 4 — API contract', () => {
  test('prepare-return is blocked while a return is already active', async () => {
    const { item } = await createMatchedPair('dup-return')

    const first = await api(`/lost-found/${item.id}/returns`, { method: 'POST', body: JSON.stringify({}) })
    await jsonOk(first)

    const second = await api(`/lost-found/${item.id}/returns`, { method: 'POST', body: JSON.stringify({}) })
    expect(second.status).toBe(409)
    const body = await second.json()
    expect(body.detail || JSON.stringify(body)).toMatch(/already in progress/i)
  })

  test('disposition queue excludes a matched item even when its retention deadline is overdue', async () => {
    const { item } = await createMatchedPair('disposition-excl')
    await dbUpdateItem(item.id, { retention_due_at: new Date(Date.now() - 2 * 86_400_000).toISOString() })

    const res = await api('/lost-found/disposition?bucket=due_now&per_page=100')
    const { data } = await jsonOk(res)
    expect((data as Array<{ id: string }>).some((row) => row.id === item.id)).toBe(false)
  })

  test('disposition queue excludes an item with an active return even if unmatched-looking', async () => {
    const { item } = await createMatchedPair('disposition-return-excl')
    const prep = await api(`/lost-found/${item.id}/returns`, { method: 'POST', body: JSON.stringify({}) })
    await jsonOk(prep)
    await dbUpdateItem(item.id, { retention_due_at: new Date(Date.now() - 2 * 86_400_000).toISOString() })

    const res = await api('/lost-found/disposition?bucket=due_now&per_page=100')
    const { data } = await jsonOk(res)
    expect((data as Array<{ id: string }>).some((row) => row.id === item.id)).toBe(false)
  })

  test('void is blocked once an item has already reached a terminal status', async () => {
    const item = await createItem(`E2E void-terminal item ${Date.now()}`)
    await dbUpdateItem(item.id, { status: 'donated' })

    const res = await api(`/lost-found/${item.id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'test_record', notes: 'E2E void-blocked check' }),
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.detail || JSON.stringify(body)).toMatch(/final outcome/i)
  })
})

test.describe('Lost & Found Phase 4 — RBAC boundary', () => {
  let seededUsers: RbacTestUser[] = []
  let frontDeskToken = ''

  test.beforeAll(async () => {
    seededUsers = await seedRbacUsers(gmToken)
    const frontDesk = seededUsers.find((u) => u.role === 'front_desk')
    if (!frontDesk) throw new Error('front_desk test user was not seeded')
    const tokenRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://oacnwalhcpqdabivweki.supabase.co'}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim() },
        body: JSON.stringify({ email: frontDesk.email, password: frontDesk.password }),
      },
    )
    const tokenJson = await tokenRes.json()
    frontDeskToken = tokenJson.access_token
  })

  test.afterAll(async () => {
    await teardownRbacUsers(gmToken, seededUsers)
  })

  test('front_desk cannot approve disposition', async () => {
    const item = await createItem(`E2E rbac-disposition item ${Date.now()}`)
    await dbUpdateItem(item.id, { retention_due_at: new Date(Date.now() - 2 * 86_400_000).toISOString() })

    const res = await fetch(`${API_URL}/v1/lost-found/${item.id}/disposition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${frontDeskToken}` },
      body: JSON.stringify({ outcome: 'donated', reason: 'E2E RBAC check' }),
    })
    expect(res.status).toBe(403)
  })

  test('front_desk cannot void a record', async () => {
    const item = await createItem(`E2E rbac-void item ${Date.now()}`)

    const res = await fetch(`${API_URL}/v1/lost-found/${item.id}/void`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${frontDeskToken}` },
      body: JSON.stringify({ reason: 'test_record', notes: 'E2E RBAC check' }),
    })
    expect(res.status).toBe(403)
  })
})

test.describe('Lost & Found Phase 4 — UI golden paths', () => {
  test('completes a pickup return end to end', async ({ page }) => {
    const { item, claim } = await createMatchedPair('pickup-ui')

    await page.goto('/lost-found?view=claims')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Matched' }).click()
    const row = page.locator('tr', { hasText: claim.guest_name })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()

    await page.getByRole('button', { name: 'Prepare Return' }).click()
    await page.getByText('Pickup at Hotel').click()

    await page.getByLabel('Recipient').fill('E2E Pickup Guest')
    await page.getByLabel('Pickup location').selectOption('Front Desk')
    await page.getByLabel(/verification method required at release/i).selectOption('Government photo ID')
    const [saveRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/pickup-details') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Save & Continue' }).click(),
    ])
    expect(saveRes.status()).toBeLessThan(300)

    const [readyRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/pickup-ready') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Mark Ready for Pickup' }).click(),
    ])
    expect(readyRes.status()).toBeLessThan(300)

    // "Complete Pickup" reveals the release form; its submit button is "Release Item".
    await page.getByRole('button', { name: 'Complete Pickup' }).click()
    await page.getByLabel('Recipient name *').fill('E2E Pickup Guest')
    await page.getByLabel('Verification method *').selectOption('Government photo ID')
    await page.getByLabel('Verification notes *').fill('Guest confirmed description of item')
    await page.getByRole('checkbox').check()
    const [completeRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/pickup-complete') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Release Item' }).click(),
    ])
    expect(completeRes.status()).toBeLessThan(300)

    const check = await api(`/lost-found/${item.id}`)
    const { data: finalItem } = await jsonOk(check)
    expect(finalItem.status).toBe('claimed')
  })

  test('completes a shipping return end to end', async ({ page }) => {
    const { item, claim } = await createMatchedPair('shipping-ui')

    await page.goto('/lost-found?view=claims')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Matched' }).click()
    const row = page.locator('tr', { hasText: claim.guest_name })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()

    await page.getByRole('button', { name: 'Prepare Return' }).click()
    await page.getByText('Ship to Guest').click()

    await page.getByLabel('Recipient').fill(claim.guest_name)
    await page.getByLabel('Address line 1').fill('123 E2E Test Lane')
    await page.getByLabel('City').fill('Fort Worth')
    await page.getByLabel('State/Region').fill('TX')
    await page.getByLabel('Postal code').fill('76137')
    const [saveRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/shipping-details') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /save shipping details/i }).click(),
    ])
    expect(saveRes.status()).toBeLessThan(300)

    await page.getByLabel(/tracking number/i).fill('E2E123456789')
    const [shipRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/ship') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /mark shipped/i }).click(),
    ])
    expect(shipRes.status()).toBeLessThan(300)

    const [completeRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/complete-shipment') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Mark Complete' }).click(),
    ])
    expect(completeRes.status()).toBeLessThan(300)

    const check = await api(`/lost-found/${item.id}`)
    const { data: finalItem } = await jsonOk(check)
    expect(finalItem.status).toBe('claimed')

    const claimCheck = await api(`/lost-found/claims/${claim.id}`)
    const { data: finalClaim } = await jsonOk(claimCheck)
    expect(finalClaim.status).toBe('closed')
  })
})

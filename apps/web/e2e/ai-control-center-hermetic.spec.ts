/**
 * H6 AI Control Center — browser checks against the hermetic production build + mock backend (no credentials, no
 * shared staging). The Control Center API is answered in the page from the fixtures below (test-only data); the
 * mock backend serves auth and the hotel, whose `enabled_features` the spec flips through /__hermetic/hotel.
 *
 *   build with the mock origin (see e2e/hermetic/run.mjs), then:
 *   npx playwright test --config=playwright.ai-control-center.config.ts
 */
import { expect, test, type Page, type Route } from '@playwright/test'
import { join } from 'node:path'
import { AUTH_DIR } from './global-setup'

const MOCK = 'http://127.0.0.1:4010'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
const AID = '11111111-1111-4111-8111-111111111111'
const RID = '22222222-2222-4222-8222-222222222222'
const NOW = new Date(Date.now() + 45 * 60_000).toISOString()

const SESSION_GM = { role: 'gm', sections: ['overview', 'agents', 'approvals', 'activity', 'controls', 'audit'], is_gm: true,
  can: { pause_hotel: true, revoke_grants: true, approve: true, control_runs: true }, notes: { approve: null } }
const SESSION_SUP = { ...SESSION_GM, role: 'housekeeping_supervisor', is_gm: false,
  sections: ['overview', 'agents', 'approvals', 'activity'], can: { ...SESSION_GM.can, pause_hotel: false, revoke_grants: false } }
const OVERVIEW = {
  platform: { gateway_execution_enabled: false, paid_model_calls_enabled: false, customer_billing_mode: 'disabled', paused: false,
    cost_emergency_stop: false, paused_agents: [], paused_tools: [], live_workers: 0 },
  hotel: { entitled: true, paused: false, paused_by_kind: null, effective_grants: 2 },
  runs: { active: 1, awaiting_approval: 1, failed_24h: 0, succeeded_24h: 3 }, approvals: { pending: 1, expiring_1h: 1 },
  refusals_24h: 0, as_of: '2026-11-17T10:00:00Z',
  readiness: { execution_ready: false, blocked_by: ['gateway_execution_disabled', 'no_live_worker'], paid_model_calls_enabled: false,
    customer_billing_mode: 'disabled' },
}
const APPROVAL = { id: AID, run_id: RID, agent_id: 'engineering.dispatch_assistant', agent_version: 2,
  tool_id: 'engineering.work_orders.assign', tool_version: 2, resource_type: 'work_order', resource_id: RID, state: 'requested',
  initiated_by_user_id: 'u-chief', initiated_by_name: 'Casey Chief', decided_by_user_id: null, decided_by_name: null,
  decided_role: null, decided_at: null, decision_reason_code: null, required_approver_roles: ['chief_engineer', 'gm'],
  expires_at: NOW, consumed_at: null, created_at: '2026-11-17T09:00:00Z' }
const CAN_REVIEW = { approve: true, reject: true, withdraw: false, reason: null }
const detail = (can: object, changed = false) => ({
  approval: APPROVAL, risk: 'medium',
  proposal: { tool_id: APPROVAL.tool_id, tool_version: 2, agent_id: APPROVAL.agent_id, agent_version: 2, action_digest: 'f'.repeat(64),
    arguments: { assignee_user_id: 'u-eng', expected_assigned_to: null, note: 'closest to floor 2' },
    assignee_name: 'Erin Engineer', expected_assignee_name: null },
  resource: { type: 'work_order', id: RID, label: 'WO-1042', title: 'Sink leaking in 204', status: 'open', priority: 'urgent',
    assigned_to: changed ? 'u-other' : null, assigned_to_name: changed ? 'Olive Other' : null, updated_at: '2026-11-17T09:00:00Z' },
  resource_changed_since_proposal: changed, handoff: null, assignee_evidence: 'active_role_member_shift_unverified', can })

type Api = Record<string, (body: unknown) => { status: number; json: unknown }>

async function stubApi(page: Page, api: Api): Promise<Array<{ method: string; path: string; body: unknown }>> {
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  await page.route((url) => url.port === '4010' && url.pathname.startsWith('/v1/agent-control-center'), async (route: Route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname.replace('/v1/agent-control-center', '')
    let body: unknown = null
    try { body = req.postDataJSON() } catch { /* none */ }
    calls.push({ method: req.method(), path, body })
    const answer = api[`${req.method()} ${path}`]?.(body) ?? { status: 500, json: { detail: { code: 'unexpected' } } }
    await route.fulfill({ status: answer.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(answer.json) })
  })
  return calls
}

const base = (session = SESSION_GM): Api => ({
  'GET /session': () => ({ status: 200, json: { data: session } }),
  'GET /overview': () => ({ status: 200, json: { data: OVERVIEW } }),
  'GET /approvals': () => ({ status: 200, json: { data: [{ ...APPROVAL, can: CAN_REVIEW }], meta: { per_page: 25, next_cursor: null } } }),
  [`GET /approvals/${AID}`]: () => ({ status: 200, json: { data: detail(CAN_REVIEW) } }),
  'GET /runs': () => ({ status: 200, json: { data: [], meta: { per_page: 25, next_cursor: null } } }),
  'GET /controls': () => ({ status: 200, json: { data: { platform: OVERVIEW.platform, hotel: { ...OVERVIEW.hotel, paused_by_name: null, can_unpause: false }, grants: [] } } }),
  'GET /audit': () => ({ status: 200, json: { data: [], meta: { per_page: 50, next_before_id: null } } }),
  'GET /agents': () => ({ status: 200, json: { data: { agents: [] } } }),
})

async function setFlags(page: Page, enabled: string[]) {
  const res = await page.request.post(`${MOCK}/__hermetic/hotel`, { data: { enabled_features: enabled } })
  expect(res.ok()).toBeTruthy()
}

async function open(page: Page, mode: 'light' | 'dark' = 'light', query = '') {
  await page.addInitScript((theme) => {
    localStorage.setItem('patelrep-ui-prefs', JSON.stringify({ state: { density: 'balanced', theme, accent: 'terracotta' }, version: 0 }))
  }, mode)
  await page.goto(`/ai-control-center${query}`)
  await expect(page.getByRole('heading', { name: 'AI Control Center', level: 1 })).toBeVisible()
}

test.describe('GM', () => {
  test.use({ storageState: join(AUTH_DIR, 'gm.json') })
  test.afterEach(async ({ page }) => { await setFlags(page, []) })

  test('hidden while the flag is off: no nav entry, no API call, an honest empty state', async ({ page }) => {
    await setFlags(page, [])
    const calls = await stubApi(page, base())
    await open(page)
    await expect(page.getByText('Not available for this hotel yet')).toBeVisible()
    await expect(page.getByRole('link', { name: 'AI Control Center' })).toHaveCount(0)
    expect(calls).toEqual([])
  })

  test('overview shows the backend readiness and keyboard navigation moves between sections', async ({ page }) => {
    await setFlags(page, ['ai_control_center'])
    await stubApi(page, base())
    await open(page)
    await expect(page.getByRole('link', { name: 'AI Control Center' }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Agents cannot act right now' })).toBeVisible()
    await expect(page.getByText('No agent worker is running')).toBeVisible()
    const tabs = page.getByRole('tab')
    await expect(tabs).toHaveText(['Overview', 'Agents', 'Approvals', 'Activity', 'Controls', 'Audit'])
    await page.getByRole('tab', { name: 'Overview' }).focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Approvals' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Approvals' })).toBeFocused()
    await expect(page).toHaveURL(/section=approvals/)
    if (process.env.ACC_SCREENSHOTS) {
      await page.getByRole('tab', { name: 'Overview' }).click()
      await page.screenshot({ path: `${process.env.ACC_SCREENSHOTS}/overview.png`, fullPage: true })
      await page.getByRole('tab', { name: 'Approvals' }).click()
      await page.getByRole('button', { name: /Assign a work order/ }).click()
      await page.getByRole('dialog', { name: 'Review agent proposal' }).getByText('Erin Engineer').waitFor()
      await page.screenshot({ path: `${process.env.ACC_SCREENSHOTS}/approval.png` })
    }
  })

  test('approval review shows the human facts, and a lost race is reported and refreshed', async ({ page }) => {
    await setFlags(page, ['ai_control_center'])
    const calls = await stubApi(page, { ...base(), [`POST /approvals/${AID}/approve`]: () => ({ status: 409, json: { detail: { code: 'not_pending' } } }) })
    await open(page, 'light', '?section=approvals')
    await page.getByRole('button', { name: /Assign a work order/ }).click()
    const drawer = page.getByRole('dialog', { name: 'Review agent proposal' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('Erin Engineer')).toBeVisible()
    await expect(drawer.getByText('Whether they are on shift now was not checked.')).toBeVisible()
    await expect(drawer.getByText('WO-1042')).toBeVisible()
    await expect(drawer.getByText('medium risk')).toBeVisible()
    await drawer.getByRole('button', { name: 'Approve' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Approve this change?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Approve' }).click()
    await expect(drawer.getByText('Someone already decided this request.')).toBeVisible()
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', path: `/approvals/${AID}/approve`, body: { reason_code: null } }])
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Assign a work order/ })).toBeFocused()  // focus returns to the opener
  })

  test('no approve button when the backend would refuse (own request; actions switched off)', async ({ page }) => {
    await setFlags(page, ['ai_control_center'])
    const own = { approve: false, reject: false, withdraw: true, reason: 'self_approval_forbidden' }
    await stubApi(page, { ...base(), [`GET /approvals/${AID}`]: () => ({ status: 200, json: { data: detail(own, true) } }) })
    await open(page, 'light', '?section=approvals')
    await page.getByRole('button', { name: /Assign a work order/ }).click()
    const drawer = page.getByRole('dialog', { name: 'Review agent proposal' })
    await expect(drawer.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    await expect(drawer.getByRole('button', { name: 'Withdraw request' })).toBeVisible()
    await expect(drawer.getByText('a different manager must review it')).toBeVisible()
    await expect(drawer.getByText(/changed after the agent proposed this/)).toBeVisible()
  })

  test('controls: pause is confirmed, sends a reason code, and an operator pause cannot be lifted here', async ({ page }) => {
    await setFlags(page, ['ai_control_center'])
    const calls = await stubApi(page, { ...base(), 'POST /controls/hotel-pause': () => ({ status: 200, json: { data: { paused: true, changed: true } } }) })
    await open(page, 'light', '?section=controls')
    await page.getByRole('button', { name: 'Pause agents' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Pause agents' }).click()
    await expect(page.getByText('Agents are paused for this hotel. Work in progress stops')).toBeVisible()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ paused: true, reason_code: 'gm_paused_from_control_center' })
    await page.unroute(() => true)
    await stubApi(page, { ...base(), 'GET /controls': () => ({ status: 200, json: { data: { platform: OVERVIEW.platform,
      hotel: { ...OVERVIEW.hotel, paused: true, paused_by_kind: 'operator', paused_by_name: null, can_unpause: false }, grants: [] } } }) })
    await page.reload()
    await expect(page.getByText('Only PatelRep support can lift this pause.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lift pause' })).toHaveCount(0)
  })

  test('phone width in dark mode: no horizontal scroll and the drawer fits', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setFlags(page, ['ai_control_center'])
    await stubApi(page, base())
    await open(page, 'dark', '?section=approvals')
    await expect(page.locator('body')).toHaveAttribute('data-dv2-mode', 'dark')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.getByRole('button', { name: /Assign a work order/ }).click()
    const box = await page.getByRole('dialog', { name: 'Review agent proposal' }).boundingBox()
    expect(box && box.width).toBeLessThanOrEqual(390)
  })
})

test.describe('Housekeeping supervisor', () => {
  test.use({ storageState: join(AUTH_DIR, 'supervisor.json') })
  test.afterEach(async ({ page }) => { await setFlags(page, []) })

  test('sees only the sections the backend allows', async ({ page }) => {
    await setFlags(page, ['ai_control_center'])
    await stubApi(page, base(SESSION_SUP))
    await open(page, 'light', '?section=controls')  // a hidden section in the URL is never opened
    await expect(page.getByRole('tab')).toHaveText(['Overview', 'Agents', 'Approvals', 'Activity'])
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  })
})

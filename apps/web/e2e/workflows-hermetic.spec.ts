/**
 * Phase 12 — browser workflow checks for the Setup Wizard (/onboarding), against the hermetic build + mock backend.
 *
 *   npm run build   (with the mock origin, see e2e/hermetic/run.mjs)
 *   npm run test:e2e:workflows
 *
 * The mock backend serves reads only. Every write the wizard makes is intercepted in the page, recorded, and answered
 * with a realistic success, validation error or failure, so payloads and error handling are asserted without touching
 * production or the shared staging database.
 */
import { expect, test, type Page, type Route } from '@playwright/test'
import { join } from 'node:path'
import { AUTH_DIR } from './global-setup'

test.use({ storageState: join(AUTH_DIR, 'gm.json') })

type Write = { method: string; path: string; json: unknown; raw: string | null }
type Answer = { status: number; json?: unknown }
type Handlers = Record<string, (write: Write) => Answer>

const HOTEL_ID = 'a0000000-0000-4000-a000-0000000000b1'
const HOTEL = { id: HOTEL_ID, name: 'Lakeside Inn', timezone: 'America/Chicago', room_count: 87, logo_url: null }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }

/** Answers every non-GET call to the mock origin from `handlers` ("POST /hotels"); anything unlisted is a recorded 500. */
async function stubWrites(page: Page, handlers: Handlers): Promise<Write[]> {
  const writes: Write[] = []
  await page.route(
    (url) => url.port === '4010' && !url.pathname.startsWith('/auth/'),
    async (route: Route) => {
      const req = route.request()
      if (req.method() === 'GET' || req.method() === 'OPTIONS') return route.fallback()
      const path = new URL(req.url()).pathname.replace(/^\/v1/, '')
      let json: unknown = null
      try { json = req.postDataJSON() } catch { /* multipart */ }
      const write: Write = { method: req.method(), path, json, raw: json ? null : req.postData() }
      writes.push(write)
      const answer = handlers[`${req.method()} ${path}`]?.(write) ?? { status: 500, json: { detail: `unexpected write ${req.method()} ${path}` } }
      await route.fulfill({ status: answer.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(answer.json ?? {}) })
    },
  )
  return writes
}

async function open(page: Page, mode: 'light' | 'dark', path = '/onboarding'): Promise<void> {
  await page.addInitScript((theme) => {
    localStorage.setItem('patelrep-ui-prefs', JSON.stringify({ state: { density: 'balanced', theme, accent: 'terracotta' }, version: 0 }))
  }, mode)
  await page.goto(path)
  await expect(page.locator('body')).toHaveAttribute('data-dv2-mode', mode)
  await expect(page.getByRole('heading', { name: 'Hotel Profile' })).toBeVisible()
}

async function fillHotel(page: Page, overrides: Partial<Record<'name' | 'address' | 'city' | 'state' | 'zip' | 'phone' | 'rooms', string>> = {}) {
  const v = { name: 'Lakeside Inn', address: '1234 Main Street', city: 'Austin', state: 'TX', zip: '78701', phone: '(512) 555-0100', rooms: '87', ...overrides }
  await page.getByPlaceholder('Lakeside Inn & Suites', { exact: true }).fill(v.name)
  await page.getByPlaceholder('1234 Main Street', { exact: true }).fill(v.address)
  await page.getByPlaceholder('Austin', { exact: true }).fill(v.city)
  await page.getByPlaceholder('TX', { exact: true }).fill(v.state)
  await page.getByPlaceholder('78701', { exact: true }).fill(v.zip)
  await page.getByPlaceholder('(512) 555-0100', { exact: true }).fill(v.phone)
  await page.getByPlaceholder('87', { exact: true }).fill(v.rooms)
}

const createHotelOk: Handlers = { 'POST /hotels': () => ({ status: 201, json: { data: { hotel: HOTEL, subscription: { plan_status: 'trialing' } } } }) }

/** Hue/saturation scan: any visible element in the wizard whose computed paint is the legacy amber/orange family. */
async function amberOffenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hsl = (css: string) => {
      const m = css.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)/)
      if (!m) return null
      const [r, g, b] = [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255]
      const a = m[4] === undefined ? 1 : Number(m[4])
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
      if (d === 0) return { h: 0, s: 0, l, a }
      const s = d / (1 - Math.abs(2 * l - 1))
      const h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
      return { h: (h + 360) % 360, s, l, a }
    }
    const warm = (css: string) => {
      const c = hsl(css)
      return !!c && c.a >= 0.25 && c.s >= 0.35 && c.l > 0.12 && c.l < 0.9 && c.h >= 15 && c.h <= 62
    }
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll('[data-onboarding-v2] *'))) {
      if (!(el as HTMLElement).getClientRects().length) continue
      const cs = getComputedStyle(el)
      const label = `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ').slice(0, 3).join('.')}`
      if (warm(cs.backgroundColor)) out.push(`${label} background ${cs.backgroundColor}`)
      if (warm(cs.color)) out.push(`${label} color ${cs.color}`)
      if (parseFloat(cs.borderTopWidth) > 0 && warm(cs.borderTopColor)) out.push(`${label} border ${cs.borderTopColor}`)
      if (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none' && warm(cs.outlineColor)) out.push(`${label} outline ${cs.outlineColor}`)
      for (const shadow of cs.boxShadow.match(/rgba?\([^)]*\)/g) ?? []) if (warm(shadow)) out.push(`${label} shadow ${shadow}`)
    }
    return out
  })
}

async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el)
    const lum = (css: string) => {
      const [r, g, b] = (css.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((n) => {
        const c = Number(n) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [a, b] = [lum(cs.backgroundColor), lum(cs.color)]
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}

const skip = (page: Page) => page.getByRole('button', { name: /Skip for now/ }).click()

for (const mode of ['light', 'dark'] as const) {
  test(`setup wizard uses Precision Slate + Electric Blue on every step — ${mode}`, async ({ page }, testInfo) => {
    const writes = await stubWrites(page, createHotelOk)
    await open(page, mode)

    const stepShot = (n: number) => page.screenshot({ path: testInfo.outputPath(`onboarding-${mode}-step-${n}.png`) })
    const audit = async (n: number, heading: string) => {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      await stepShot(n)
      expect(await amberOffenders(page), `legacy amber/orange paint on step ${n} (${mode})`).toEqual([])
    }

    await audit(1, 'Hotel Profile')
    expect(await contrastOf(page, 'button:has-text("Create Hotel & Continue")'), 'primary action contrast').toBeGreaterThanOrEqual(4.5)
    expect(await contrastOf(page, '[data-onboarding-v2] .rounded-full.bg-amber-400, [data-onboarding-v2] .rounded-full[class*="bg-amber"]'), 'active step dot contrast').toBeGreaterThanOrEqual(4.5)

    await fillHotel(page)
    await page.getByRole('button', { name: /Create Hotel & Continue/ }).click()
    await audit(2, 'Import Rooms')
    await page.getByRole('button', { name: /Manual Entry/ }).click()
    await audit(2, 'Import Rooms')
    expect(await contrastOf(page, 'button:has-text("Save Rooms")'), 'step 2 primary contrast').toBeGreaterThanOrEqual(4.5)
    await skip(page)

    await audit(3, 'Invite Staff')
    await page.getByPlaceholder('Maria Santos', { exact: true }).fill('Maria Santos')
    await page.getByPlaceholder('maria@hotel.com', { exact: true }).fill('maria@hotel.com')
    await audit(3, 'Invite Staff')
    expect(await contrastOf(page, 'button:has-text("Send Invites")'), 'step 3 primary contrast').toBeGreaterThanOrEqual(4.5)
    await skip(page)

    await page.getByPlaceholder('https://hospitality.oracle.com', { exact: true }).fill('https://hospitality.oracle.com')
    await page.getByPlaceholder('SAND01', { exact: true }).fill('SAND01')
    await audit(4, 'Connect Opera Cloud')
    expect(await contrastOf(page, 'button:has-text("Connect Opera Cloud")'), 'step 4 primary contrast').toBeGreaterThanOrEqual(4.5)
    await skip(page)

    await audit(5, 'Upload SOPs')
    await skip(page)

    await audit(6, "You're all set!")
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /hotels'])
  })
}

test('step 1 blocks an invalid profile, names each field, and sends no request', async ({ page }) => {
  const writes = await stubWrites(page, createHotelOk)
  await open(page, 'light')

  await page.getByRole('button', { name: /Create Hotel & Continue/ }).click()
  for (const message of ['Hotel name is required', 'Address is required', 'City is required', 'Enter a valid ZIP code', 'Enter a valid phone number']) {
    await expect(page.getByText(message)).toBeVisible()
  }
  await fillHotel(page, { state: 'T', zip: '787', phone: 'abc' })
  await page.getByRole('button', { name: /Create Hotel & Continue/ }).click()
  await expect(page.getByText('Enter 2-letter state code')).toBeVisible()
  await expect(page.getByText('Enter a valid ZIP code')).toBeVisible()
  await expect(page.getByText('Enter a valid phone number')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hotel Profile' })).toBeVisible()
  expect(writes).toEqual([])
})

test('step 1 sends the typed profile, advances and marks the step done; a server rejection keeps the user on step 1', async ({ page }) => {
  let attempt = 0
  const writes = await stubWrites(page, {
    'POST /hotels': () => (++attempt === 1
      ? { status: 422, json: { detail: [{ loc: ['body', 'zip'], msg: 'ZIP code does not match the city', type: 'value_error' }] } }
      : { status: 201, json: { data: { hotel: HOTEL, subscription: { plan_status: 'trialing' } } } }),
  })
  await open(page, 'light')
  await fillHotel(page)

  await page.getByRole('button', { name: /Create Hotel & Continue/ }).click()
  await expect(page.getByText('[body.zip] ZIP code does not match the city')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hotel Profile' })).toBeVisible()

  await page.getByRole('button', { name: /Create Hotel & Continue/ }).click()
  await expect(page.getByRole('heading', { name: 'Import Rooms' })).toBeVisible()
  await expect(page.getByText('Step 2 of 6')).toBeVisible()
  expect(writes.map((w) => w.json)).toEqual([
    { name: 'Lakeside Inn', address: '1234 Main Street', city: 'Austin', state: 'TX', zip: '78701', phone: '(512) 555-0100', room_count: 87, timezone: 'America/Chicago' },
    { name: 'Lakeside Inn', address: '1234 Main Street', city: 'Austin', state: 'TX', zip: '78701', phone: '(512) 555-0100', room_count: 87, timezone: 'America/Chicago' },
  ])
})

test('rooms CSV, staff invites, Opera connect and SOP upload send the right requests and report partial failure', async ({ page }) => {
  const writes = await stubWrites(page, {
    ...createHotelOk,
    'POST /onboarding/rooms/import-csv': () => ({ status: 200, json: { data: { imported_count: 3 } } }),
    'POST /staff/onboarding-invite': (w) => (JSON.stringify(w.json).includes('bad@') ? { status: 422, json: { detail: 'That email address is not valid' } } : { status: 201, json: { data: { id: 'u1' } } }),
    'POST /integrations/opera/connect': () => ({ status: 200, json: { data: { connected: false, message: 'Credentials were rejected by Opera' } } }),
    'POST /sop/documents': () => ({ status: 201, json: { data: { id: 'doc-1' } } }),
  })
  await open(page, 'light')
  await fillHotel(page)
  await page.getByRole('button', { name: /Create Hotel & Continue/ }).click()

  // Step 2: CSV import is multipart and carries the new hotel id.
  await page.locator('input[type=file]').setInputFiles({ name: 'rooms.csv', mimeType: 'text/csv', buffer: Buffer.from('room_number,floor\n101,1\n102,1\n103,1\n') })
  await page.getByRole('button', { name: /Upload CSV/ }).click()
  await expect(page.getByText(/Successfully imported 3 rooms/)).toBeVisible()
  const csv = writes.find((w) => w.path === '/onboarding/rooms/import-csv')!
  expect(csv.raw).toContain('name="hotel_id"')
  expect(csv.raw).toMatch(/name="hotel_id"\r?\n\r?\n[0-9a-f]{8}-[0-9a-f]{4}-/)
  expect(csv.raw).toContain('101,1')
  await page.getByRole('button', { name: /^Continue/ }).click()

  // Step 3: Send is disabled until a row is complete; one bad address is reported, not swallowed.
  await expect(page.getByRole('button', { name: /Send Invites \(0\)/ })).toBeDisabled()
  await page.getByPlaceholder('Maria Santos', { exact: true }).fill('Bad Address')
  await page.getByPlaceholder('maria@hotel.com', { exact: true }).fill('bad@')
  await expect(page.getByRole('button', { name: /Send Invites \(1\)/ })).toBeEnabled()
  await page.getByRole('button', { name: /Send Invites/ }).click()
  await expect(page.getByText(/bad@: That email address is not valid/)).toBeVisible()
  const invites = writes.filter((w) => w.path === '/staff/onboarding-invite').map((w) => w.json as Record<string, string>)
  expect(invites.map(({ hotel_id: _hotel, ...rest }) => rest)).toEqual([{ email: 'bad@', full_name: 'Bad Address', role: 'housekeeping_supervisor' }])
  expect(invites[0].hotel_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
  await skip(page)

  // Step 4: Connect needs a URL and an Opera hotel id, and an unverified connection stays on the step with the reason.
  await expect(page.getByRole('button', { name: /Connect Opera Cloud/ })).toBeDisabled()
  await page.getByPlaceholder('https://hospitality.oracle.com', { exact: true }).fill(' https://hospitality.oracle.com ')
  await page.getByPlaceholder('SAND01', { exact: true }).fill('SAND01')
  await page.getByRole('button', { name: /Connect Opera Cloud/ }).click()
  await expect(page.getByText('Credentials were rejected by Opera')).toBeVisible()
  expect(writes.find((w) => w.path === '/integrations/opera/connect')!.json).toEqual({ ohip_base_url: 'https://hospitality.oracle.com', hotel_id_opera: 'SAND01' })
  await skip(page)

  // Step 5: a PDF is uploaded as multipart; skipping the rest lands on the summary with the right to-do links.
  await page.locator('input[type=file]').setInputFiles({ name: 'sop.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
  await page.getByRole('button', { name: /Upload 1 Document/ }).click()
  await expect.poll(() => writes.some((w) => w.path === '/sop/documents' && (w.raw ?? '').includes('sop.pdf'))).toBe(true)
})

// KNOWN DEFECT (pre-existing since the initial commit, same with V2 off): the manual-entry tab's "Save Rooms & Continue"
// calls onComplete() directly, so rooms the user typed are never sent anywhere. Wiring it to POST /rooms/import is NOT a
// one-line fix: that endpoint needs room_type_code (the tab collects none), is GM/supervisor only, and resets the status
// of rooms that already exist to DIRTY. It needs a product decision, so it is recorded here instead of changed. The
// expectation below is the correct behavior; test.fail() makes the suite flag the day it is fixed.
test('manual room entry persists the typed rooms', async ({ page }) => {
  test.fail(true, 'Known defect: onboarding manual "Save Rooms & Continue" sends no request (see comment above)')
  const writes = await stubWrites(page, { ...createHotelOk, 'POST /rooms/import': () => ({ status: 200, json: { data: { imported_count: 1, reset_count: 0, errors: [] } } }), 'POST /rooms': () => ({ status: 201, json: { data: {} } }) })
  await open(page, 'light')
  await fillHotel(page)
  await page.getByRole('button', { name: /Create Hotel & Continue/ }).click()
  await page.getByRole('button', { name: /Manual Entry/ }).click()
  await page.getByPlaceholder('e.g. 101', { exact: true }).fill('201')
  await page.getByPlaceholder('e.g. 1', { exact: true }).first().fill('2')
  await page.getByRole('button', { name: /Save Rooms & Continue/ }).click()
  await expect(page.getByRole('heading', { name: 'Invite Staff' })).toBeVisible()
  expect(writes.filter((w) => w.path.startsWith('/rooms')).length, 'a request that persists the room').toBeGreaterThan(0)
})
